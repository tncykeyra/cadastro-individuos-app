-- Keep every duplicate warrant intake for an explicit administrator decision.
create table if not exists public.arrest_warrant_duplicate_submissions (
  id uuid primary key default gen_random_uuid(),
  matched_warrant_id uuid not null references public.arrest_warrants(id) on delete restrict,
  import_batch_id uuid references public.arrest_warrant_import_batches(id) on delete set null,
  source_kind text not null check (source_kind in ('csv','pdf','manual')),
  duplicate_reason text not null check (duplicate_reason in ('process_number','agency_warrant_number','pdf_exact_hash','pdf_candidate','csv_duplicate','concurrent_insert')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  storage_path text unique,
  document_name text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes between 1 and 20971520),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  constraint arrest_warrant_duplicate_document_metadata_check
    check ((storage_path is null and document_name is null and file_size_bytes is null and content_sha256 is null)
        or (storage_path is not null and document_name is not null and file_size_bytes is not null and content_sha256 is not null))
);

create index if not exists arrest_warrant_duplicate_pending_idx
  on public.arrest_warrant_duplicate_submissions (status, created_at desc);
create index if not exists arrest_warrant_duplicate_matched_idx
  on public.arrest_warrant_duplicate_submissions (matched_warrant_id, created_at desc);

alter table public.arrest_warrant_documents
  add column if not exists content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}

alter table public.arrest_warrant_duplicate_submissions enable row level security;
grant select, insert on table public.arrest_warrant_duplicate_submissions to authenticated;

drop policy if exists arrest_warrant_duplicate_admin_read on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_read
  on public.arrest_warrant_duplicate_submissions
  for select to authenticated
  using (public.is_admin());

drop policy if exists arrest_warrant_duplicate_admin_insert on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_insert
  on public.arrest_warrant_duplicate_submissions
  for insert to authenticated
  with check (public.is_admin() and submitted_by = (select auth.uid()));

create or replace function public.admin_review_arrest_warrant_duplicate(
  p_submission_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.arrest_warrant_duplicate_submissions%rowtype;
  v_warrant public.arrest_warrants%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem revisar mandados duplicados.';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'Decisão inválida.';
  end if;

  select *
    into v_submission
    from public.arrest_warrant_duplicate_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'A submissão duplicada não foi encontrada.';
  end if;
  if v_submission.status <> 'pending' then
    raise exception 'Esta submissão já foi revisada.';
  end if;

  select *
    into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;

  if not found then
    raise exception 'O mandado original não foi encontrado. Nenhuma informação foi removida.';
  end if;

  if p_decision = 'approve' then
    -- Keep the existing record as canonical; fill blank fields only.
    update public.arrest_warrants
       set cpf_digits = coalesce(nullif(cpf_digits, ''), nullif(v_submission.payload->>'cpf_digits', '')),
           birth_date = coalesce(birth_date, nullif(v_submission.payload->>'birth_date', '')::date),
           alias = coalesce(nullif(alias, ''), nullif(v_submission.payload->>'alias', '')),
           mother_name = coalesce(nullif(mother_name, ''), nullif(v_submission.payload->>'mother_name', '')),
           father_name = coalesce(nullif(father_name, ''), nullif(v_submission.payload->>'father_name', '')),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_warrant.id;

    if v_submission.storage_path is not null and not exists (
      select 1 from public.arrest_warrant_documents d
       where d.content_sha256 = v_submission.content_sha256
    ) then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, content_sha256, created_by)
      values
        (v_warrant.id, v_submission.storage_path, v_submission.document_name,
         'application/pdf', v_submission.file_size_bytes, v_submission.content_sha256, auth.uid())
      on conflict (storage_path) do nothing;
    end if;

    update public.arrest_warrant_duplicate_submissions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_approved',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason,
                          'document_attached', v_submission.storage_path is not null));
  else
    update public.arrest_warrant_duplicate_submissions
       set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_rejected',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason));
  end if;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'matched_warrant_id', v_warrant.id
  );
end;
$function$;

revoke all on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) to authenticated;
),
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  constraint arrest_warrant_duplicate_document_metadata_check
    check ((storage_path is null and document_name is null and file_size_bytes is null)
        or (storage_path is not null and document_name is not null and file_size_bytes is not null))
);

create index if not exists arrest_warrant_duplicate_pending_idx
  on public.arrest_warrant_duplicate_submissions (status, created_at desc);
create index if not exists arrest_warrant_duplicate_matched_idx
  on public.arrest_warrant_duplicate_submissions (matched_warrant_id, created_at desc);

alter table public.arrest_warrant_duplicate_submissions enable row level security;
grant select, insert on table public.arrest_warrant_duplicate_submissions to authenticated;

drop policy if exists arrest_warrant_duplicate_admin_read on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_read
  on public.arrest_warrant_duplicate_submissions
  for select to authenticated
  using (public.is_admin());

drop policy if exists arrest_warrant_duplicate_admin_insert on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_insert
  on public.arrest_warrant_duplicate_submissions
  for insert to authenticated
  with check (public.is_admin() and submitted_by = (select auth.uid()));

create or replace function public.admin_review_arrest_warrant_duplicate(
  p_submission_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.arrest_warrant_duplicate_submissions%rowtype;
  v_warrant public.arrest_warrants%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem revisar mandados duplicados.';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'Decisão inválida.';
  end if;

  select *
    into v_submission
    from public.arrest_warrant_duplicate_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'A submissão duplicada não foi encontrada.';
  end if;
  if v_submission.status <> 'pending' then
    raise exception 'Esta submissão já foi revisada.';
  end if;

  select *
    into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;

  if not found then
    raise exception 'O mandado original não foi encontrado. Nenhuma informação foi removida.';
  end if;

  if p_decision = 'approve' then
    -- Keep the existing record as canonical; fill blank fields only.
    update public.arrest_warrants
       set cpf_digits = coalesce(nullif(cpf_digits, ''), nullif(v_submission.payload->>'cpf_digits', '')),
           birth_date = coalesce(birth_date, nullif(v_submission.payload->>'birth_date', '')::date),
           alias = coalesce(nullif(alias, ''), nullif(v_submission.payload->>'alias', '')),
           mother_name = coalesce(nullif(mother_name, ''), nullif(v_submission.payload->>'mother_name', '')),
           father_name = coalesce(nullif(father_name, ''), nullif(v_submission.payload->>'father_name', '')),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_warrant.id;

    if v_submission.storage_path is not null then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, created_by)
      values
        (v_warrant.id, v_submission.storage_path, v_submission.document_name,
         'application/pdf', v_submission.file_size_bytes, auth.uid())
      on conflict (storage_path) do nothing;
    end if;

    update public.arrest_warrant_duplicate_submissions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_approved',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason,
                          'document_attached', v_submission.storage_path is not null));
  else
    update public.arrest_warrant_duplicate_submissions
       set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_rejected',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason));
  end if;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'matched_warrant_id', v_warrant.id
  );
end;
$function$;

revoke all on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) to authenticated;
);
create index if not exists arrest_warrant_documents_size_idx
  on public.arrest_warrant_documents (file_size_bytes);
create index if not exists arrest_warrant_documents_sha256_idx
  on public.arrest_warrant_documents (content_sha256)
  where content_sha256 is not null;

alter table public.arrest_warrant_duplicate_submissions enable row level security;
grant select, insert on table public.arrest_warrant_duplicate_submissions to authenticated;

drop policy if exists arrest_warrant_duplicate_admin_read on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_read
  on public.arrest_warrant_duplicate_submissions
  for select to authenticated
  using (public.is_admin());

drop policy if exists arrest_warrant_duplicate_admin_insert on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_insert
  on public.arrest_warrant_duplicate_submissions
  for insert to authenticated
  with check (public.is_admin() and submitted_by = (select auth.uid()));

create or replace function public.admin_review_arrest_warrant_duplicate(
  p_submission_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.arrest_warrant_duplicate_submissions%rowtype;
  v_warrant public.arrest_warrants%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem revisar mandados duplicados.';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'Decisão inválida.';
  end if;

  select *
    into v_submission
    from public.arrest_warrant_duplicate_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'A submissão duplicada não foi encontrada.';
  end if;
  if v_submission.status <> 'pending' then
    raise exception 'Esta submissão já foi revisada.';
  end if;

  select *
    into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;

  if not found then
    raise exception 'O mandado original não foi encontrado. Nenhuma informação foi removida.';
  end if;

  if p_decision = 'approve' then
    -- Keep the existing record as canonical; fill blank fields only.
    update public.arrest_warrants
       set cpf_digits = coalesce(nullif(cpf_digits, ''), nullif(v_submission.payload->>'cpf_digits', '')),
           birth_date = coalesce(birth_date, nullif(v_submission.payload->>'birth_date', '')::date),
           alias = coalesce(nullif(alias, ''), nullif(v_submission.payload->>'alias', '')),
           mother_name = coalesce(nullif(mother_name, ''), nullif(v_submission.payload->>'mother_name', '')),
           father_name = coalesce(nullif(father_name, ''), nullif(v_submission.payload->>'father_name', '')),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_warrant.id;

    if v_submission.storage_path is not null then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, created_by)
      values
        (v_warrant.id, v_submission.storage_path, v_submission.document_name,
         'application/pdf', v_submission.file_size_bytes, auth.uid())
      on conflict (storage_path) do nothing;
    end if;

    update public.arrest_warrant_duplicate_submissions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_approved',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason,
                          'document_attached', v_submission.storage_path is not null));
  else
    update public.arrest_warrant_duplicate_submissions
       set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_rejected',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason));
  end if;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'matched_warrant_id', v_warrant.id
  );
end;
$function$;

revoke all on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) to authenticated;
),
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  constraint arrest_warrant_duplicate_document_metadata_check
    check ((storage_path is null and document_name is null and file_size_bytes is null)
        or (storage_path is not null and document_name is not null and file_size_bytes is not null))
);

create index if not exists arrest_warrant_duplicate_pending_idx
  on public.arrest_warrant_duplicate_submissions (status, created_at desc);
create index if not exists arrest_warrant_duplicate_matched_idx
  on public.arrest_warrant_duplicate_submissions (matched_warrant_id, created_at desc);

alter table public.arrest_warrant_duplicate_submissions enable row level security;
grant select, insert on table public.arrest_warrant_duplicate_submissions to authenticated;

drop policy if exists arrest_warrant_duplicate_admin_read on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_read
  on public.arrest_warrant_duplicate_submissions
  for select to authenticated
  using (public.is_admin());

drop policy if exists arrest_warrant_duplicate_admin_insert on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_insert
  on public.arrest_warrant_duplicate_submissions
  for insert to authenticated
  with check (public.is_admin() and submitted_by = (select auth.uid()));

create or replace function public.admin_review_arrest_warrant_duplicate(
  p_submission_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.arrest_warrant_duplicate_submissions%rowtype;
  v_warrant public.arrest_warrants%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem revisar mandados duplicados.';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'Decisão inválida.';
  end if;

  select *
    into v_submission
    from public.arrest_warrant_duplicate_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'A submissão duplicada não foi encontrada.';
  end if;
  if v_submission.status <> 'pending' then
    raise exception 'Esta submissão já foi revisada.';
  end if;

  select *
    into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;

  if not found then
    raise exception 'O mandado original não foi encontrado. Nenhuma informação foi removida.';
  end if;

  if p_decision = 'approve' then
    -- Keep the existing record as canonical; fill blank fields only.
    update public.arrest_warrants
       set cpf_digits = coalesce(nullif(cpf_digits, ''), nullif(v_submission.payload->>'cpf_digits', '')),
           birth_date = coalesce(birth_date, nullif(v_submission.payload->>'birth_date', '')::date),
           alias = coalesce(nullif(alias, ''), nullif(v_submission.payload->>'alias', '')),
           mother_name = coalesce(nullif(mother_name, ''), nullif(v_submission.payload->>'mother_name', '')),
           father_name = coalesce(nullif(father_name, ''), nullif(v_submission.payload->>'father_name', '')),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_warrant.id;

    if v_submission.storage_path is not null then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, created_by)
      values
        (v_warrant.id, v_submission.storage_path, v_submission.document_name,
         'application/pdf', v_submission.file_size_bytes, auth.uid())
      on conflict (storage_path) do nothing;
    end if;

    update public.arrest_warrant_duplicate_submissions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_approved',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason,
                          'document_attached', v_submission.storage_path is not null));
  else
    update public.arrest_warrant_duplicate_submissions
       set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = left(coalesce(p_notes, ''), 1000)
     where id = p_submission_id;

    insert into public.arrest_warrant_events
      (warrant_id, warrant_number, actor_id, action, detail)
    values
      (v_warrant.id, v_warrant.warrant_number, auth.uid(), 'duplicate_submission_rejected',
       jsonb_build_object('submission_id', p_submission_id,
                          'source_kind', v_submission.source_kind,
                          'duplicate_reason', v_submission.duplicate_reason));
  end if;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'matched_warrant_id', v_warrant.id
  );
end;
$function$;

revoke all on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) to authenticated;
