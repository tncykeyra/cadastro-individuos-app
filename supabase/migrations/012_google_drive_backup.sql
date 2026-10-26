-- Private, additive backup metadata and worker scheduling.
-- No existing application rows or Storage objects are modified by this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed')),
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual','scheduled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  progress jsonb not null default '{}'::jsonb,
  error_code text
);

create index if not exists backup_runs_created_at_idx
  on public.backup_runs (created_at desc);

create table if not exists public.backup_snapshot_rows (
  run_id uuid not null references public.backup_runs(id) on delete cascade,
  entity text not null,
  sequence bigint not null,
  row_data jsonb not null,
  primary key (run_id, entity, sequence)
);

create table if not exists public.backup_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.backup_runs(id) on delete cascade,
  artifact_key text not null,
  kind text not null check (kind in ('database','media','manifest')),
  drive_file_id text not null,
  created_at timestamptz not null default now(),
  unique (run_id, artifact_key)
);

create table if not exists public.backup_file_index (
  object_name text primary key,
  bucket_id text not null,
  source_size bigint not null,
  source_etag text,
  source_last_modified timestamptz,
  content_tag text not null,
  drive_file_id text not null,
  last_seen_run uuid references public.backup_runs(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists backup_file_index_content_tag_idx
  on public.backup_file_index (content_tag);

create table if not exists public.backup_run_storage_items (
  run_id uuid not null references public.backup_runs(id) on delete cascade,
  object_name text not null,
  content_tag text not null,
  drive_file_id text not null,
  source_size bigint not null,
  mimetype text,
  primary key (run_id, object_name)
);

create table if not exists public.backup_oauth_states (
  state text primary key,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.backup_runs enable row level security;
alter table public.backup_snapshot_rows enable row level security;
alter table public.backup_artifacts enable row level security;
alter table public.backup_file_index enable row level security;
alter table public.backup_run_storage_items enable row level security;
alter table public.backup_oauth_states enable row level security;

revoke all on public.backup_runs, public.backup_snapshot_rows,
  public.backup_artifacts, public.backup_file_index,
  public.backup_run_storage_items, public.backup_oauth_states
  from public, anon, authenticated;

grant select, insert, update, delete on public.backup_runs,
  public.backup_snapshot_rows, public.backup_artifacts,
  public.backup_file_index, public.backup_run_storage_items,
  public.backup_oauth_states to service_role;

create or replace function public.backup_secret_get(p_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select case
    when p_name = any(array[
      'google_client_id',
      'google_client_secret',
      'google_refresh_token',
      'google_drive_folder_id',
      'backup_crypto_key',
      'backup_cron_secret'
    ]::text[])
    then (
      select ds.decrypted_secret
      from vault.decrypted_secrets as ds
      where ds.name = p_name
      limit 1
    )
    else null
  end;
$$;

create or replace function public.backup_secret_set(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name is null or p_name <> all(array[
    'google_client_id',
    'google_client_secret',
    'google_refresh_token',
    'google_drive_folder_id',
    'backup_crypto_key',
    'backup_cron_secret'
  ]::text[]) then
    raise exception 'Unsupported backup secret name';
  end if;

  if p_secret is null or length(p_secret) = 0 or length(p_secret) > 8192 then
    raise exception 'Invalid backup secret value';
  end if;

  select s.id into v_id
  from vault.secrets as s
  where s.name = p_name
  limit 1;

  if v_id is null then
    perform vault.create_secret(p_secret, p_name, 'Cadastro Criminal backup integration');
  else
    perform vault.update_secret(v_id, p_secret, p_name, 'Cadastro Criminal backup integration');
  end if;
end;
$$;

create or replace function public.backup_capture_snapshot(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  if not exists (select 1 from public.backup_runs where id = p_run_id) then
    raise exception 'Backup run not found';
  end if;

  delete from public.backup_snapshot_rows where run_id = p_run_id;

  insert into public.backup_snapshot_rows(run_id, entity, sequence, row_data)
  select
    p_run_id,
    source.entity,
    row_number() over (partition by source.entity order by source.row_key)::bigint,
    source.row_data
  from (
    select 'people'::text as entity, p.id::text as row_key, to_jsonb(p) as row_data
      from public.people as p
    union all
    select 'vehicles'::text, v.id::text, to_jsonb(v)
      from public.vehicles as v
    union all
    select 'person_vehicle_links'::text, l.id::text, to_jsonb(l)
      from public.person_vehicle_links as l
    union all
    select 'record_photos'::text, p.id::text, to_jsonb(p)
      from public.record_photos as p
    union all
    select 'person_photos'::text, p.id::text, to_jsonb(p)
      from public.person_photos as p
    union all
    select 'vehicle_photos'::text, p.id::text, to_jsonb(p)
      from public.vehicle_photos as p
    union all
    select 'record_revisions'::text, r.id::text, to_jsonb(r)
      from public.record_revisions as r
    union all
    select 'audit_events'::text, a.id::text, to_jsonb(a)
      from public.audit_events as a
    union all
    select 'authorized_emails'::text, e.email::text, to_jsonb(e)
      from public.authorized_emails as e
    union all
    select 'profiles'::text, pr.id::text, to_jsonb(pr)
      from public.profiles as pr
  ) as source;

  select coalesce(jsonb_object_agg(counts.entity, counts.total), '{}'::jsonb)
    into v_counts
  from (
    select entity, count(*)::bigint as total
    from public.backup_snapshot_rows
    where run_id = p_run_id
    group by entity
  ) as counts;

  return v_counts;
end;
$$;

create or replace function public.backup_list_storage_objects(
  p_after text default '',
  p_limit integer default 10
)
returns table (
  object_name text,
  object_size bigint,
  object_etag text,
  object_last_modified timestamptz,
  object_mimetype text
)
language sql
security definer
set search_path = ''
as $$
  select
    o.name,
    coalesce(nullif(o.metadata->>'size','')::bigint, nullif(o.metadata->>'contentLength','')::bigint, 0),
    o.metadata->>'eTag',
    o.updated_at,
    o.metadata->>'mimetype'
  from storage.objects as o
  where o.bucket_id = 'people-photos'
    and o.name > coalesce(p_after, '')
  order by o.name
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.backup_secret_get(text) from public, anon, authenticated;
revoke all on function public.backup_secret_set(text, text) from public, anon, authenticated;
revoke all on function public.backup_capture_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.backup_list_storage_objects(text, integer) from public, anon, authenticated;
grant execute on function public.backup_secret_get(text) to service_role;
grant execute on function public.backup_secret_set(text, text) to service_role;
grant execute on function public.backup_capture_snapshot(uuid) to service_role;
grant execute on function public.backup_list_storage_objects(text, integer) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'backup_cron_secret',
      'Private caller secret for scheduled Cadastro Criminal backups'
    );
  end if;
end $$;

do $backup_schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'cadastro-backup-worker';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'cadastro-backup-worker',
    '* * * * *',
    $worker$
      select net.http_post(
        url := 'https://etvxrzjtnhuefxeirkxf.supabase.co/functions/v1/backup-drive',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-backup-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_secret')
        ),
        body := '{"action":"worker"}'::jsonb,
        timeout_milliseconds := 5000
      );
    $worker$
  );

  select jobid into v_job_id from cron.job where jobname = 'cadastro-backup-daily';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'cadastro-backup-daily',
    '0 6 * * *',
    $daily$
      select net.http_post(
        url := 'https://etvxrzjtnhuefxeirkxf.supabase.co/functions/v1/backup-drive',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-backup-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_secret')
        ),
        body := '{"action":"scheduled_start"}'::jsonb,
        timeout_milliseconds := 5000
      );
    $daily$
  );
end
$backup_schedule$;
