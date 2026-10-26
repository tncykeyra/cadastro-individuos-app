-- Secure warrant registry with reviewed person links and audited discharge reporting.
create table if not exists public.arrest_warrant_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_type text not null check (source_type in ('csv','pdf','manual')),
  records_total integer not null default 0 check (records_total >= 0),
  records_inserted integer not null default 0 check (records_inserted >= 0),
  records_ignored integer not null default 0 check (records_ignored >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.arrest_warrants (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.arrest_warrant_import_batches(id) on delete set null,
  warrant_number text not null check (length(btrim(warrant_number)) between 1 and 120),
  full_name text not null check (length(btrim(full_name)) between 2 and 180),
  cpf_digits text check (cpf_digits is null or cpf_digits ~ '^[0-9]{11}$'),
  alias text not null default '',
  mother_name text not null default '',
  father_name text not null default '',
  birth_date date,
  source_agency text not null default 'BNMP',
  source_kind text not null check (source_kind in ('csv','pdf','manual')),
  source_reference text not null default '',
  status text not null default 'pending'
    check (status in ('pending','discharge_reported','discharged','cancelled','revoked')),
  discharge_reported_at timestamptz,
  discharge_reported_date date,
  discharge_reference text not null default '',
  discharge_notes text not null default '',
  discharge_confirmed_at timestamptz,
  discharge_confirmed_date date,
  discharge_confirmed_reference text not null default '',
  discharge_confirmed_notes text not null default '',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_agency, warrant_number)
);

create index if not exists arrest_warrants_status_name_idx
  on public.arrest_warrants (status, full_name);
create index if not exists arrest_warrants_cpf_idx
  on public.arrest_warrants (cpf_digits) where cpf_digits is not null;
create index if not exists arrest_warrants_import_batch_idx
  on public.arrest_warrants (import_batch_id);

create table if not exists public.arrest_warrant_matches (
  id uuid primary key default gen_random_uuid(),
  warrant_id uuid not null references public.arrest_warrants(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  match_basis text not null check (match_basis in ('cpf_exact','name_birthdate','name_exact','manual_review')),
  confidence smallint not null check (confidence between 0 and 100),
  review_status text not null default 'candidate'
    check (review_status in ('candidate','confirmed','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (warrant_id, person_id)
);

create unique index if not exists arrest_warrant_one_confirmed_match_idx
  on public.arrest_warrant_matches (warrant_id)
  where review_status = 'confirmed';
create index if not exists arrest_warrant_matches_person_status_idx
  on public.arrest_warrant_matches (person_id, review_status);
create index if not exists arrest_warrant_matches_status_idx
  on public.arrest_warrant_matches (review_status, warrant_id);

create table if not exists public.arrest_warrant_documents (
  id uuid primary key default gen_random_uuid(),
  warrant_id uuid not null references public.arrest_warrants(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null check (content_type = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 20971520),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.arrest_warrant_events (
  id bigint generated always as identity primary key,
  warrant_id uuid not null references public.arrest_warrants(id) on delete restrict,
  actor_id uuid references auth.users(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists arrest_warrant_events_warrant_time_idx
  on public.arrest_warrant_events (warrant_id, occurred_at desc);

create or replace function public.normalize_arrest_warrant_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(value, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

create or replace function public.audit_arrest_warrant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_detail jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'warrant_created';
    v_detail := jsonb_build_object('status', new.status, 'source_kind', new.source_kind);
  elsif old.status is distinct from new.status then
    v_action := 'warrant_status_changed';
    v_detail := jsonb_build_object('from', old.status, 'to', new.status);
  else
    v_action := 'warrant_updated';
  end if;

  insert into public.arrest_warrant_events (warrant_id, actor_id, action, detail)
  values (new.id, (select auth.uid()), v_action, v_detail);
  return new;
end;
$$;

create or replace function public.audit_arrest_warrant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'match_candidate_created';
  elsif old.review_status is distinct from new.review_status then
    v_action := 'match_' || new.review_status;
  else
    v_action := 'match_updated';
  end if;

  insert into public.arrest_warrant_events (warrant_id, actor_id, action, detail)
  values (
    new.warrant_id,
    (select auth.uid()),
    v_action,
    jsonb_build_object('basis', new.match_basis, 'confidence', new.confidence, 'review_status', new.review_status)
  );
  return new;
end;
$$;

drop trigger if exists arrest_warrants_audit_trigger on public.arrest_warrants;
create trigger arrest_warrants_audit_trigger
after insert or update on public.arrest_warrants
for each row execute function public.audit_arrest_warrant();

drop trigger if exists arrest_warrant_matches_audit_trigger on public.arrest_warrant_matches;
create trigger arrest_warrant_matches_audit_trigger
after insert or update on public.arrest_warrant_matches
for each row execute function public.audit_arrest_warrant_match();

create or replace function public.admin_suggest_arrest_warrant_matches(p_warrant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warrant public.arrest_warrants%rowtype;
  v_inserted integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem revisar correspondências.';
  end if;

  select * into v_warrant
  from public.arrest_warrants
  where id = p_warrant_id and status in ('pending','discharge_reported');

  if not found then
    raise exception 'Mandado não encontrado ou não está pendente.';
  end if;

  insert into public.arrest_warrant_matches
    (warrant_id, person_id, match_basis, confidence, review_status)
  select
    v_warrant.id,
    p.id,
    case
      when v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits then 'cpf_exact'
      when p.birthday is not null and p.birthday = v_warrant.birth_date then 'name_birthdate'
      else 'name_exact'
    end,
    case
      when v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits then 100
      when p.birthday is not null and p.birthday = v_warrant.birth_date then 90
      else 75
    end,
    'candidate'
  from public.people p
  where p.archived_at is null
    and (
      (v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits)
      or (
        (v_warrant.cpf_digits is null or p.cpf_digits is null)
        and public.normalize_arrest_warrant_name(p.full_name)
          = public.normalize_arrest_warrant_name(v_warrant.full_name)
      )
    )
  on conflict (warrant_id, person_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.admin_review_arrest_warrant_match(p_match_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem revisar correspondências.';
  end if;
  if p_decision not in ('confirmed','rejected') then
    raise exception 'Decisão inválida.';
  end if;

  update public.arrest_warrant_matches
  set review_status = p_decision,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_match_id and review_status = 'candidate';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Esta correspondência já foi revisada ou não existe.';
  end if;
end;
$$;

create or replace function public.report_arrest_warrant_discharge(
  p_warrant_id uuid,
  p_discharge_date date,
  p_reference text,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_discharge_date is null or p_discharge_date > current_date then
    raise exception 'Informe uma data válida para a baixa.';
  end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'Informe a referência oficial da baixa.';
  end if;
  if not exists (
    select 1
    from public.arrest_warrant_matches m
    where m.warrant_id = p_warrant_id and m.review_status = 'confirmed'
  ) then
    raise exception 'Este mandado ainda não foi vinculado por um administrador.';
  end if;

  update public.arrest_warrants
  set status = 'discharge_reported',
      discharge_reported_at = now(),
      discharge_reported_date = p_discharge_date,
      discharge_reference = btrim(p_reference),
      discharge_notes = btrim(coalesce(p_notes, '')),
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_warrant_id and status = 'pending';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'O mandado não está mais pendente. Atualize a tela e confira o status.';
  end if;
end;
$$;

create or replace function public.admin_confirm_arrest_warrant_discharge(
  p_warrant_id uuid,
  p_confirmed_date date,
  p_reference text,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem confirmar a baixa.';
  end if;
  if p_confirmed_date is null or p_confirmed_date > current_date then
    raise exception 'Informe uma data válida para confirmar a baixa.';
  end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'Informe a referência oficial da baixa confirmada.';
  end if;

  update public.arrest_warrants
  set status = 'discharged',
      discharge_confirmed_at = now(),
      discharge_confirmed_date = p_confirmed_date,
      discharge_confirmed_reference = btrim(p_reference),
      discharge_confirmed_notes = btrim(coalesce(p_notes, '')),
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_warrant_id and status = 'discharge_reported';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Não há uma baixa informada aguardando confirmação.';
  end if;
end;
$$;

alter table public.arrest_warrant_import_batches enable row level security;
alter table public.arrest_warrants enable row level security;
alter table public.arrest_warrant_matches enable row level security;
alter table public.arrest_warrant_documents enable row level security;
alter table public.arrest_warrant_events enable row level security;

drop policy if exists arrest_warrant_batches_admin_read on public.arrest_warrant_import_batches;
create policy arrest_warrant_batches_admin_read
on public.arrest_warrant_import_batches for select to authenticated
using (public.is_admin());

drop policy if exists arrest_warrant_batches_admin_insert on public.arrest_warrant_import_batches;
create policy arrest_warrant_batches_admin_insert
on public.arrest_warrant_import_batches for insert to authenticated
with check (public.is_admin() and created_by = (select auth.uid()));

drop policy if exists arrest_warrant_batches_admin_update on public.arrest_warrant_import_batches;
create policy arrest_warrant_batches_admin_update
on public.arrest_warrant_import_batches for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists arrest_warrants_staff_read_confirmed on public.arrest_warrants;
create policy arrest_warrants_staff_read_confirmed
on public.arrest_warrants for select to authenticated
using (
  public.is_admin()
  or (
    public.can_use_app()
    and exists (
      select 1 from public.arrest_warrant_matches m
      where m.warrant_id = arrest_warrants.id and m.review_status = 'confirmed'
    )
  )
);

drop policy if exists arrest_warrants_admin_insert on public.arrest_warrants;
create policy arrest_warrants_admin_insert
on public.arrest_warrants for insert to authenticated
with check (public.is_admin() and created_by = (select auth.uid()) and updated_by = (select auth.uid()));

drop policy if exists arrest_warrants_admin_update on public.arrest_warrants;
create policy arrest_warrants_admin_update
on public.arrest_warrants for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists arrest_warrant_matches_staff_read_confirmed on public.arrest_warrant_matches;
create policy arrest_warrant_matches_staff_read_confirmed
on public.arrest_warrant_matches for select to authenticated
using (public.is_admin() or (public.can_use_app() and review_status = 'confirmed'));

drop policy if exists arrest_warrant_matches_admin_insert on public.arrest_warrant_matches;
create policy arrest_warrant_matches_admin_insert
on public.arrest_warrant_matches for insert to authenticated
with check (public.is_admin());

drop policy if exists arrest_warrant_matches_admin_update on public.arrest_warrant_matches;
create policy arrest_warrant_matches_admin_update
on public.arrest_warrant_matches for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists arrest_warrant_documents_admin_read on public.arrest_warrant_documents;
create policy arrest_warrant_documents_admin_read
on public.arrest_warrant_documents for select to authenticated
using (public.is_admin());

drop policy if exists arrest_warrant_documents_admin_insert on public.arrest_warrant_documents;
create policy arrest_warrant_documents_admin_insert
on public.arrest_warrant_documents for insert to authenticated
with check (public.is_admin() and created_by = (select auth.uid()));

drop policy if exists arrest_warrant_documents_admin_delete on public.arrest_warrant_documents;
create policy arrest_warrant_documents_admin_delete
on public.arrest_warrant_documents for delete to authenticated
using (public.is_admin());

drop policy if exists arrest_warrant_events_admin_or_confirmed_read on public.arrest_warrant_events;
create policy arrest_warrant_events_admin_or_confirmed_read
on public.arrest_warrant_events for select to authenticated
using (
  public.is_admin()
  or (
    public.can_use_app()
    and exists (
      select 1 from public.arrest_warrant_matches m
      where m.warrant_id = arrest_warrant_events.warrant_id and m.review_status = 'confirmed'
    )
  )
);

grant select, insert, update on public.arrest_warrant_import_batches to authenticated;
grant select, insert, update on public.arrest_warrants to authenticated;
grant select, insert, update on public.arrest_warrant_matches to authenticated;
grant select, insert, delete on public.arrest_warrant_documents to authenticated;
grant select on public.arrest_warrant_events to authenticated;

revoke all on function public.normalize_arrest_warrant_name(text) from public, anon;
grant execute on function public.normalize_arrest_warrant_name(text) to authenticated;
revoke all on function public.admin_suggest_arrest_warrant_matches(uuid) from public, anon;
grant execute on function public.admin_suggest_arrest_warrant_matches(uuid) to authenticated;
revoke all on function public.admin_review_arrest_warrant_match(uuid, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_match(uuid, text) to authenticated;
revoke all on function public.report_arrest_warrant_discharge(uuid, date, text, text) from public, anon;
grant execute on function public.report_arrest_warrant_discharge(uuid, date, text, text) to authenticated;
revoke all on function public.admin_confirm_arrest_warrant_discharge(uuid, date, text, text) from public, anon;
grant execute on function public.admin_confirm_arrest_warrant_discharge(uuid, date, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('warrant-documents', 'warrant-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists warrant_documents_storage_admin_read on storage.objects;
create policy warrant_documents_storage_admin_read
on storage.objects for select to authenticated
using (bucket_id = 'warrant-documents' and public.is_admin());

drop policy if exists warrant_documents_storage_admin_insert on storage.objects;
create policy warrant_documents_storage_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'warrant-documents' and public.is_admin());

drop policy if exists warrant_documents_storage_admin_update on storage.objects;
create policy warrant_documents_storage_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'warrant-documents' and public.is_admin())
with check (bucket_id = 'warrant-documents' and public.is_admin());

drop policy if exists warrant_documents_storage_admin_delete on storage.objects;
create policy warrant_documents_storage_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'warrant-documents' and public.is_admin());


-- Restrict direct REST reads to fields needed by the reviewed staff workflow.
-- Source CPF, birth date, aliases, and family names remain in the database for admin-only matching,
-- and are never exposed as table columns to operators.
revoke select on table public.arrest_warrants from authenticated;
grant select (
  id, import_batch_id, warrant_number, full_name, source_agency, source_kind,
  source_reference, status, discharge_reported_at, discharge_reported_date,
  discharge_reference, discharge_confirmed_at,
  discharge_confirmed_date, discharge_confirmed_reference,
  created_at, updated_at
) on table public.arrest_warrants to authenticated;

revoke select on table public.arrest_warrant_matches from authenticated;
grant select (
  id, warrant_id, person_id, match_basis, confidence, review_status, created_at
) on table public.arrest_warrant_matches to authenticated;
