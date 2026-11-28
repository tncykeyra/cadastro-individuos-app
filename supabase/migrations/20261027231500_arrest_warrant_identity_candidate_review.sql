-- Keep rescanned/re-exported PDF candidates from creating a second active warrant.
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
  v_cpf_digits text := nullif(regexp_replace(coalesce(p_payload->>'cpf_digits',''), '[^0-9]', '', 'g'), '');
  v_birth_date date := nullif(p_payload->>'birth_date','')::date;
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


  -- A re-exported or rescanned copy may have different bytes and OCR identifiers.
  -- Same CPF, or same full name plus birth date, is held for admin review.
  if v_warrant_id is null and coalesce(p_payload->>'source_kind','') = 'pdf' then
    select w.id into v_warrant_id
      from public.arrest_warrants w
     where (v_cpf_digits is not null
            and regexp_replace(coalesce(w.cpf_digits,''), '[^0-9]', '', 'g') = v_cpf_digits)
        or (v_birth_date is not null
            and lower(regexp_replace(btrim(w.full_name), '[[:space:]]+', ' ', 'g'))
                = lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'))
            and w.birth_date = v_birth_date)
     order by w.created_at desc
     limit 1;
    if found then v_duplicate_reason := 'pdf_candidate'; end if;
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

