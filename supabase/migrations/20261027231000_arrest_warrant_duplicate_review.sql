-- Preserve possible duplicate warrant intake for an administrator decision.
-- No existing warrant, document, or person record is modified by this migration.
create table if not exists public.arrest_warrant_duplicate_submissions (
  id uuid primary key default gen_random_uuid(),
  matched_warrant_id uuid not null,
  import_batch_id uuid references public.arrest_warrant_import_batches(id) on delete set null,
  source_kind text not null check (source_kind in ('csv','pdf','manual')),
  duplicate_reason text not null check (
    duplicate_reason in ('process_number','agency_warrant_number','pdf_exact_hash','pdf_candidate','csv_duplicate','concurrent_insert')
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  storage_path text unique,
  document_name text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes between 1 and 20971520),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','registered')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  constraint arrest_warrant_duplicate_document_metadata_check
    check (
      (storage_path is null and document_name is null and file_size_bytes is null)
      or
      (storage_path is not null and document_name is not null and file_size_bytes is not null)
    )
);

create index if not exists arrest_warrant_duplicate_pending_idx
  on public.arrest_warrant_duplicate_submissions (status, created_at desc);
create index if not exists arrest_warrant_duplicate_matched_idx
  on public.arrest_warrant_duplicate_submissions (matched_warrant_id, created_at desc);
create index if not exists arrest_warrant_duplicate_hash_idx
  on public.arrest_warrant_duplicate_submissions (content_sha256)
  where content_sha256 is not null;

alter table public.arrest_warrant_documents
  add column if not exists content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists arrest_warrant_documents_size_idx
  on public.arrest_warrant_documents (file_size_bytes);
create unique index if not exists arrest_warrant_documents_sha256_uidx
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

-- Serialize new PDF intake by exact file hash, process number, and warrant identity.
-- The check and insert of the canonical warrant/document happen in one transaction.
create or replace function public.admin_create_arrest_warrant_intake(
  p_payload jsonb,
  p_storage_path text default null,
  p_document_name text default null,
  p_file_size_bytes bigint default null,
  p_content_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_number text := upper(btrim(coalesce(p_payload->>'warrant_number','')));
  v_name text := btrim(coalesce(p_payload->>'full_name',''));
  v_agency text := upper(btrim(coalesce(p_payload->>'source_agency','BNMP')));
  v_reference text := btrim(coalesce(p_payload->>'source_reference',''));
  v_process_digits text := nullif(regexp_replace(v_reference, '\D', '', 'g'), '');
  v_sha text := nullif(p_content_sha256, '');
  v_warrant_id uuid;
  v_submission_id uuid;
  v_duplicate_reason text;
  v_duplicate_path text;
  v_duplicate_name text;
  v_duplicate_size bigint;
  v_duplicate_sha text;
  v_is_exact_pdf boolean := false;
  v_has_warrant boolean := false;
  v_new_warrant_id uuid;
begin
  if v_user_id is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem incluir mandados.';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or v_number = '' or length(v_name) < 2 then
    raise exception 'Informe número e nome válidos para o mandado.';
  end if;
  if (p_storage_path is null) <> (v_sha is null)
     or (p_storage_path is null) <> (p_document_name is null)
     or (p_storage_path is null) <> (p_file_size_bytes is null) then
    raise exception 'Os dados do PDF estão incompletos.';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'A verificação do PDF é inválida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    coalesce(v_sha,'') || '|' || coalesce(v_process_digits,'') || '|' || v_agency || '|' || v_number, 0
  ));

  if v_sha is not null then
    select d.warrant_id into v_warrant_id
      from public.arrest_warrant_documents d
     where d.content_sha256 = v_sha
     limit 1;
    if found then
      v_duplicate_reason := 'pdf_exact_hash';
      v_is_exact_pdf := true;
    else
      select s.id, s.matched_warrant_id into v_submission_id, v_warrant_id
        from public.arrest_warrant_duplicate_submissions s
       where s.content_sha256 = v_sha and s.status = 'pending'
       order by s.created_at
       limit 1;
      if found then
        return jsonb_build_object(
          'created', false, 'duplicate', true, 'already_pending', true,
          'submission_id', v_submission_id, 'warrant_id', v_warrant_id,
          'reason', 'pdf_exact_hash', 'discard_uploaded_file', true
        );
      end if;
    end if;
  end if;

  if v_warrant_id is null and v_process_digits is not null then
    select w.id into v_warrant_id
      from public.arrest_warrants w
     where w.process_number_digits = v_process_digits
     limit 1;
    if found then v_duplicate_reason := 'process_number'; end if;
  end if;

  if v_warrant_id is null then
    select w.id into v_warrant_id
      from public.arrest_warrants w
     where upper(btrim(w.source_agency)) = v_agency
       and upper(btrim(w.warrant_number)) = v_number
     limit 1;
    if found then v_duplicate_reason := 'agency_warrant_number'; end if;
  end if;

  if v_warrant_id is not null then
    if v_is_exact_pdf then
      -- An identical PDF is already safely stored; keep the submission data,
      -- not a second copy of the same private file.
      v_duplicate_path := null;
      v_duplicate_name := null;
      v_duplicate_size := null;
      v_duplicate_sha := v_sha;
    else
      v_duplicate_path := p_storage_path;
      v_duplicate_name := p_document_name;
      v_duplicate_size := p_file_size_bytes;
      v_duplicate_sha := v_sha;
    end if;

    select s.id into v_submission_id
      from public.arrest_warrant_duplicate_submissions s
     where v_sha is not null and s.content_sha256 = v_sha and s.status = 'pending'
     order by s.created_at
     limit 1;
    if found then
      return jsonb_build_object(
        'created', false, 'duplicate', true, 'already_pending', true,
        'submission_id', v_submission_id, 'warrant_id', v_warrant_id,
        'reason', coalesce(v_duplicate_reason, 'pdf_exact_hash'),
        'discard_uploaded_file', true
      );
    end if;

    insert into public.arrest_warrant_duplicate_submissions
      (matched_warrant_id, source_kind, duplicate_reason, payload,
       storage_path, document_name, file_size_bytes, content_sha256, submitted_by)
    values
      (v_warrant_id, coalesce(nullif(p_payload->>'source_kind',''),'manual'),
       coalesce(v_duplicate_reason, 'pdf_candidate'), p_payload,
       v_duplicate_path, v_duplicate_name, v_duplicate_size, v_duplicate_sha, v_user_id)
    returning id into v_submission_id;

    return jsonb_build_object(
      'created', false, 'duplicate', true, 'already_pending', false,
      'submission_id', v_submission_id, 'warrant_id', v_warrant_id,
      'reason', coalesce(v_duplicate_reason, 'pdf_candidate'),
      'discard_uploaded_file', v_is_exact_pdf
    );
  end if;

  insert into public.arrest_warrants
    (warrant_number, full_name, cpf_digits, birth_date, source_agency, source_kind,
     source_reference, status, created_by, updated_by)
  values
    (v_number, v_name, nullif(regexp_replace(coalesce(p_payload->>'cpf_digits',''), '\D', '', 'g'), ''),
     nullif(p_payload->>'birth_date','')::date, v_agency,
     coalesce(nullif(p_payload->>'source_kind',''),'manual'), v_reference, 'pending', v_user_id, v_user_id)
  returning id into v_warrant_id;

  if p_storage_path is not null then
    insert into public.arrest_warrant_documents
      (warrant_id, storage_path, file_name, content_type, file_size_bytes, content_sha256, created_by)
    values
      (v_warrant_id, p_storage_path, left(p_document_name,220), 'application/pdf',
       p_file_size_bytes, v_sha, v_user_id);
  end if;

  return jsonb_build_object('created', true, 'duplicate', false, 'warrant_id', v_warrant_id);
end;
$function$;

revoke all on function public.admin_create_arrest_warrant_intake(jsonb, text, text, bigint, text) from public, anon;
grant execute on function public.admin_create_arrest_warrant_intake(jsonb, text, text, bigint, text) to authenticated;

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
  v_has_warrant boolean := false;
  v_new_warrant_id uuid;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem revisar mandados duplicados.';
  end if;
  if p_decision not in ('approve','reject','register_distinct') then
    raise exception 'Decisão inválida.';
  end if;

  select * into v_submission
    from public.arrest_warrant_duplicate_submissions
   where id = p_submission_id
   for update;
  if not found then raise exception 'A submissão não foi encontrada.'; end if;
  if v_submission.status <> 'pending' then raise exception 'Esta submissão já foi revisada.'; end if;

  select * into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;
  v_has_warrant := found;

  if p_decision = 'register_distinct' then
    if not v_has_warrant then raise exception 'O mandado relacionado não existe mais; não foi criado nenhum registro.'; end if;
    insert into public.arrest_warrants
      (import_batch_id, warrant_number, full_name, cpf_digits, birth_date, source_agency,
       source_kind, source_reference, status, created_by, updated_by)
    values
      (v_submission.import_batch_id,
       upper(btrim(coalesce(v_submission.payload->>'warrant_number',''))),
       btrim(coalesce(v_submission.payload->>'full_name','')),
       nullif(regexp_replace(coalesce(v_submission.payload->>'cpf_digits',''), '\\D', '', 'g'), ''),
       nullif(v_submission.payload->>'birth_date','')::date,
       upper(btrim(coalesce(v_submission.payload->>'source_agency','BNMP'))),
       coalesce(nullif(v_submission.payload->>'source_kind',''),'manual'),
       btrim(coalesce(v_submission.payload->>'source_reference','')), 'pending', auth.uid(), auth.uid())
    returning id into v_new_warrant_id;
    if v_submission.storage_path is not null and not exists (
      select 1 from public.arrest_warrant_documents d where d.content_sha256=v_submission.content_sha256
    ) then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, content_sha256, created_by)
      values (v_new_warrant_id, v_submission.storage_path, v_submission.document_name,
              'application/pdf', v_submission.file_size_bytes, v_submission.content_sha256, auth.uid())
      on conflict do nothing;
    end if;
  elsif p_decision = 'approve' then
    if not v_has_warrant then raise exception 'O mandado original não existe mais; não foi criado nenhum registro.'; end if;
    update public.arrest_warrants
       set cpf_digits = coalesce(nullif(cpf_digits,''), nullif(v_submission.payload->>'cpf_digits','')),
           birth_date = coalesce(birth_date, nullif(v_submission.payload->>'birth_date','')::date),
           alias = coalesce(nullif(alias,''), nullif(v_submission.payload->>'alias','')),
           mother_name = coalesce(nullif(mother_name,''), nullif(v_submission.payload->>'mother_name','')),
           father_name = coalesce(nullif(father_name,''), nullif(v_submission.payload->>'father_name','')),
           updated_by = auth.uid(), updated_at = now()
     where id = v_warrant.id;

    if v_submission.storage_path is not null and not exists (
      select 1 from public.arrest_warrant_documents d
       where d.content_sha256 = v_submission.content_sha256
    ) then
      insert into public.arrest_warrant_documents
        (warrant_id, storage_path, file_name, content_type, file_size_bytes, content_sha256, created_by)
      values (v_warrant.id, v_submission.storage_path, v_submission.document_name,
              'application/pdf', v_submission.file_size_bytes, v_submission.content_sha256, auth.uid())
      on conflict do nothing;
    end if;
  end if;

  update public.arrest_warrant_duplicate_submissions
     set status = case when p_decision='approve' then 'approved' when p_decision='register_distinct' then 'registered' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_notes = left(coalesce(p_notes,''),1000)
   where id = p_submission_id;

  if v_has_warrant then
    insert into public.arrest_warrant_events (warrant_id, warrant_number, actor_id, action, detail)
    values (v_warrant.id, v_warrant.warrant_number, auth.uid(),
            case when p_decision='approve' then 'duplicate_submission_approved' when p_decision='register_distinct' then 'duplicate_submission_registered' else 'duplicate_submission_rejected' end,
            jsonb_build_object('submission_id',p_submission_id,'source_kind',v_submission.source_kind,
                               'duplicate_reason',v_submission.duplicate_reason,
                               'document_attached',v_submission.storage_path is not null));
  end if;

  return jsonb_build_object('submission_id',p_submission_id,
    'status',case when p_decision='approve' then 'approved' when p_decision='register_distinct' then 'registered' else 'rejected' end,
    'matched_warrant_id',v_submission.matched_warrant_id,
    'warrant_id',coalesce(v_new_warrant_id,v_submission.matched_warrant_id));
end;
$function$;

revoke all on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_arrest_warrant_duplicate(uuid, text, text) to authenticated;
