-- Correct warrant duplicate matching to use real identifiers and the active city only.
-- Also make the administrative "delete all" action clear review submissions and return their private PDF paths.
begin;
create unique index if not exists arrest_warrant_documents_city_sha256_uidx
  on public.arrest_warrant_documents(city_id, content_sha256)
  where content_sha256 is not null;
drop index if exists public.arrest_warrant_documents_sha256_uidx;
CREATE OR REPLACE FUNCTION public.admin_create_arrest_warrant_intake(p_payload jsonb, p_storage_path text DEFAULT NULL::text, p_document_name text DEFAULT NULL::text, p_file_size_bytes bigint DEFAULT NULL::bigint, p_content_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_city_id uuid := public.current_city_id();
  v_number text := upper(btrim(coalesce(p_payload->>'warrant_number','')));
  v_name text := btrim(coalesce(p_payload->>'full_name',''));
  v_agency text := upper(btrim(coalesce(p_payload->>'source_agency','BNMP')));
  v_reference text := btrim(coalesce(p_payload->>'source_reference',''));
  v_cpf_digits text := nullif(regexp_replace(coalesce(p_payload->>'cpf_digits',''), '[^0-9]', '', 'g'), '');
  v_birth_date date := nullif(p_payload->>'birth_date','')::date;
  v_process_digits text := CASE
    WHEN v_reference ~ '([0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4})'
    THEN nullif(regexp_replace(substring(v_reference from '([0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4})'), '[^0-9]', '', 'g'), '')
    ELSE NULL END;
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
  v_specific_number boolean := v_number ~ '[0-9]';
  v_new_warrant_id uuid;
begin
  if v_user_id is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem incluir mandados.';
  end if;
  if v_city_id is null or public.can_access_city(v_city_id) is not true then
    raise exception 'Selecione uma cidade autorizada para incluir mandados.';
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
    v_city_id::text || '|' || coalesce(v_sha,'') || '|' || coalesce(v_process_digits,'') || '|' || v_agency || '|' || v_number, 0
  ));

  if v_sha is not null then
    select d.warrant_id into v_warrant_id
      from public.arrest_warrant_documents d
     where d.city_id = v_city_id and d.content_sha256 = v_sha
     limit 1;
    if found then
      v_duplicate_reason := 'pdf_exact_hash';
      v_is_exact_pdf := true;
    else
      select s.id, s.matched_warrant_id into v_submission_id, v_warrant_id
        from public.arrest_warrant_duplicate_submissions s
       where s.city_id = v_city_id and s.content_sha256 = v_sha and s.status = 'pending'
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
     where w.city_id = v_city_id and w.process_number_digits = v_process_digits
     limit 1;
    if found then v_duplicate_reason := 'process_number'; end if;
  end if;

  if v_warrant_id is null and v_specific_number then
    select w.id into v_warrant_id
      from public.arrest_warrants w
     where w.city_id = v_city_id
       and upper(btrim(w.source_agency)) = v_agency
       and upper(btrim(w.warrant_number)) = v_number
     limit 1;
    if found then v_duplicate_reason := 'agency_warrant_number'; end if;
  end if;


  -- Re-exports/rescans can change bytes and OCR may miss identifiers.
  -- Same CPF or the same full name is held for admin review; ambiguous cases
  -- are never silently registered as a new active warrant.
  if v_warrant_id is null and coalesce(p_payload->>'source_kind','') = 'pdf' then
    select w.id into v_warrant_id
      from public.arrest_warrants w
     where w.city_id = v_city_id
       and ((v_cpf_digits is not null
            and regexp_replace(coalesce(w.cpf_digits,''), '[^0-9]', '', 'g') = v_cpf_digits)
        or lower(regexp_replace(btrim(w.full_name), '[[:space:]]+', ' ', 'g'))
           = lower(regexp_replace(v_name, '[[:space:]]+', ' ', 'g')))
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
     where v_sha is not null and s.city_id = v_city_id and s.content_sha256 = v_sha and s.status = 'pending'
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


  if p_storage_path is not null and v_process_digits is null then
    raise exception 'Informe ou confira o número completo do processo antes de salvar este PDF; não foi criado nenhum novo mandado.';
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

CREATE OR REPLACE FUNCTION public.admin_review_arrest_warrant_duplicate(p_submission_id uuid, p_decision text, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where id = p_submission_id and city_id = public.current_city_id()
   for update;
  if not found then raise exception 'A submissão não foi encontrada nesta cidade.'; end if;
  if not public.can_access_city(v_submission.city_id) then raise exception 'Sem permissão para revisar esta cidade.'; end if;
  if v_submission.status <> 'pending' then raise exception 'Esta submissão já foi revisada.'; end if;
  if p_decision = 'register_distinct' and v_submission.duplicate_reason = 'pdf_exact_hash' then
    raise exception 'Este PDF é idêntico ao arquivo já armazenado e não pode ser cadastrado como um novo mandado.';
  end if;

  select * into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id and city_id = v_submission.city_id
   for update;
  v_has_warrant := found;

  -- Process numbers are unique identifiers: a different-looking PDF with the same
  -- process number must never be registered as a second warrant.
  if p_decision = 'register_distinct' and exists (
    select 1
      from public.arrest_warrants w
     where w.city_id = v_submission.city_id
       and w.process_number_digits = nullif(
         regexp_replace(substring(coalesce(v_submission.payload->>'source_reference','') from '([0-9]{7}-[0-9]{2}[.][0-9]{4}[.][0-9][.][0-9]{2}[.][0-9]{4})'), '[^0-9]', '', 'g'),
         ''
     )
  ) then
    raise exception 'Já existe um mandado com esse número de processo. Confirme a duplicidade ou rejeite esta submissão; não é possível registrar outro mandado com o mesmo processo.';
  end if;

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
      select 1 from public.arrest_warrant_documents d where d.city_id=v_submission.city_id and d.content_sha256=v_submission.content_sha256
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
           alias = coalesce(nullif(alias,''), nullif(v_submission.payload->>'alias',''), ''),
           mother_name = coalesce(nullif(mother_name,''), nullif(v_submission.payload->>'mother_name',''), ''),
           father_name = coalesce(nullif(father_name,''), nullif(v_submission.payload->>'father_name',''), ''),
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
   where id = p_submission_id and city_id = v_submission.city_id;

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

CREATE OR REPLACE FUNCTION public.admin_delete_all_arrest_warrants()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_city_id uuid;
  v_deleted_count integer := 0;
  v_storage_paths text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir mandados.';
  END IF;

  v_city_id := public.current_city_id();
  IF v_city_id IS NULL OR NOT public.can_access_city(v_city_id) THEN
    RAISE EXCEPTION 'Selecione uma cidade autorizada para excluir mandados.';
  END IF;

  PERFORM w.id
    FROM public.arrest_warrants AS w
   WHERE w.city_id = v_city_id
   FOR UPDATE;

  SELECT count(*)::integer
    INTO v_deleted_count
    FROM public.arrest_warrants AS w
   WHERE w.city_id = v_city_id;

  SELECT coalesce(array_agg(DISTINCT paths.storage_path), ARRAY[]::text[])
    INTO v_storage_paths
    FROM (
      SELECT d.storage_path FROM public.arrest_warrant_documents d
       WHERE d.city_id = v_city_id AND d.warrant_id IN (SELECT w.id FROM public.arrest_warrants w WHERE w.city_id = v_city_id)
      UNION ALL
      SELECT s.storage_path FROM public.arrest_warrant_duplicate_submissions s
       WHERE s.city_id = v_city_id AND s.storage_path IS NOT NULL
    ) paths;

  INSERT INTO public.arrest_warrant_events
    (warrant_id, warrant_number, actor_id, action, detail, city_id)
  SELECT NULL, w.warrant_number, auth.uid(), 'warrant_deleted',
         jsonb_build_object(
           'status', w.status,
           'source_agency', w.source_agency,
           'source_kind', w.source_kind,
           'attached_pdf_count', coalesce(documents.document_count, 0),
           'bulk_delete', true,
           'deleted_city_id', v_city_id
         ),
         v_city_id
    FROM public.arrest_warrants AS w
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS document_count
        FROM public.arrest_warrant_documents AS d
       WHERE d.warrant_id = w.id AND d.city_id = v_city_id
    ) AS documents ON true
   WHERE w.city_id = v_city_id;

  DELETE FROM public.arrest_warrant_duplicate_submissions s WHERE s.city_id = v_city_id;

  DELETE FROM public.arrest_warrant_matches AS m
   WHERE m.city_id = v_city_id
     AND m.warrant_id IN (SELECT w.id FROM public.arrest_warrants AS w WHERE w.city_id = v_city_id);

  DELETE FROM public.arrest_warrant_person_proposals AS p
   WHERE p.city_id = v_city_id
     AND p.warrant_id IN (SELECT w.id FROM public.arrest_warrants AS w WHERE w.city_id = v_city_id);

  DELETE FROM public.arrest_warrant_documents AS d
   WHERE d.city_id = v_city_id
     AND d.warrant_id IN (SELECT w.id FROM public.arrest_warrants AS w WHERE w.city_id = v_city_id);

  UPDATE public.arrest_warrant_events AS e
     SET warrant_number = coalesce(e.warrant_number, w.warrant_number),
         warrant_id = NULL
    FROM public.arrest_warrants AS w
   WHERE w.city_id = v_city_id
     AND e.city_id = v_city_id
     AND e.warrant_id = w.id;

  DELETE FROM public.arrest_warrants AS w
   WHERE w.city_id = v_city_id;

  RETURN jsonb_build_object('deleted_count', v_deleted_count, 'storage_paths', to_jsonb(v_storage_paths));
END;
$function$;

commit;