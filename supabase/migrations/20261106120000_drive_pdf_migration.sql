create table if not exists public.drive_pdf_migration_queue (
  source_path text primary key,
  file_name text not null,
  byte_size bigint,
  status text not null default 'pending' check (status in ('pending','processing','copied','failed')),
  attempts integer not null default 0,
  drive_file_id text,
  sha256 text,
  last_error_code text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drive_pdf_migrations (
  source_path text primary key,
  drive_file_id text not null,
  file_name text not null,
  sha256 text not null,
  byte_size bigint not null,
  status text not null default 'active' check (status in ('active','rolled_back')),
  migrated_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  created_by uuid
);

alter table public.drive_pdf_migration_queue enable row level security;
alter table public.drive_pdf_migrations enable row level security;
revoke all on public.drive_pdf_migration_queue from anon, authenticated;
revoke all on public.drive_pdf_migrations from anon, authenticated;
grant all on public.drive_pdf_migration_queue to service_role;
grant all on public.drive_pdf_migrations to service_role;

create or replace function public.queue_warrant_pdf_for_drive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(new.storage_path), '');
  v_json jsonb := to_jsonb(new);
  v_name text := coalesce(nullif(v_json->>'document_name',''), nullif(v_json->>'file_name',''), split_part(coalesce(v_path,''), '/', -1));
  v_size bigint := nullif(v_json->>'file_size_bytes','')::bigint;
  v_actor uuid := coalesce(nullif(v_json->>'created_by','')::uuid, nullif(v_json->>'submitted_by','')::uuid);
begin
  if v_path is null or v_path like 'drive:%' or v_path like 'blob:%' or v_path like 'data:%' then
    return new;
  end if;
  if lower(coalesce(v_name,'')) not like '%.pdf' and lower(v_path) not like '%.pdf' then
    return new;
  end if;
  insert into public.drive_pdf_migration_queue(source_path,file_name,byte_size,requested_by)
  values(v_path,coalesce(v_name,'mandado.pdf'),v_size,v_actor)
  on conflict(source_path) do update
    set status='pending', attempts=0, last_error_code=null, updated_at=now()
    where public.drive_pdf_migration_queue.status='failed';
  return new;
end;
$$;

drop trigger if exists queue_warrant_pdf_drive_documents on public.arrest_warrant_documents;
create trigger queue_warrant_pdf_drive_documents
after insert or update of storage_path on public.arrest_warrant_documents
for each row execute function public.queue_warrant_pdf_for_drive();

drop trigger if exists queue_warrant_pdf_drive_duplicates on public.arrest_warrant_duplicate_submissions;
create trigger queue_warrant_pdf_drive_duplicates
after insert or update of storage_path on public.arrest_warrant_duplicate_submissions
for each row execute function public.queue_warrant_pdf_for_drive();

create or replace function public.drive_enqueue_existing_pdfs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.drive_pdf_migration_queue(source_path,file_name,byte_size)
  select o.name, split_part(o.name,'/',array_length(string_to_array(o.name,'/'),1)),
         nullif(o.metadata->>'size','')::bigint
  from storage.objects o
  where o.bucket_id='warrant-documents'
    and coalesce(o.metadata->>'mimetype','')='application/pdf'
    and coalesce(o.is_delete_marker,false)=false
  on conflict(source_path) do nothing;
  get diagnostics inserted_count = row_count;

  insert into public.drive_pdf_migration_queue(source_path,file_name,byte_size,requested_by)
  select d.storage_path,coalesce(nullif(d.file_name,''),split_part(d.storage_path,'/',array_length(string_to_array(d.storage_path,'/'),1))),d.file_size_bytes,d.created_by
  from public.arrest_warrant_documents d
  where d.storage_path is not null and d.storage_path not like 'drive:%'
  on conflict(source_path) do nothing;

  insert into public.drive_pdf_migration_queue(source_path,file_name,byte_size,requested_by)
  select d.storage_path,coalesce(nullif(d.document_name,''),split_part(d.storage_path,'/',array_length(string_to_array(d.storage_path,'/'),1))),d.file_size_bytes,d.submitted_by
  from public.arrest_warrant_duplicate_submissions d
  where d.storage_path is not null and d.storage_path not like 'drive:%'
  on conflict(source_path) do nothing;

  return inserted_count;
end;
$$;

create or replace function public.drive_pdf_migration_progress()
returns table(total bigint,migrated bigint,remaining bigint,failed bigint)
language sql
security definer
set search_path = ''
as $$
  select count(*)::bigint,
         count(*) filter (where status='copied')::bigint,
         count(*) filter (where status in ('pending','processing'))::bigint,
         count(*) filter (where status='failed')::bigint
  from public.drive_pdf_migration_queue;
$$;

revoke all on function public.drive_enqueue_existing_pdfs() from public, anon, authenticated;
revoke all on function public.drive_pdf_migration_progress() from public, anon, authenticated;
grant execute on function public.drive_enqueue_existing_pdfs() to service_role;
grant execute on function public.drive_pdf_migration_progress() to service_role;