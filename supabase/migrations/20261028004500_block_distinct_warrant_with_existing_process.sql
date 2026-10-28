-- A process number is unique and cannot be manually overridden as a distinct warrant.
-- An identical file is conclusive evidence of a repeat; do not allow manual override to create another warrant.
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
  if p_decision = 'register_distinct' and v_submission.duplicate_reason = 'pdf_exact_hash' then
    raise exception 'Este PDF é idêntico ao arquivo já armazenado e não pode ser cadastrado como um novo mandado.';
  end if;

  select * into v_warrant
    from public.arrest_warrants
   where id = v_submission.matched_warrant_id
   for update;
  v_has_warrant := found;

  -- Process numbers are unique identifiers: a different-looking PDF with the same
  -- process number must never be registered as a second warrant.
  if p_decision = 'register_distinct' and exists (
    select 1
      from public.arrest_warrants w
     where w.process_number_digits = nullif(
       regexp_replace(coalesce(v_submission.payload->>'source_reference',''), '[^0-9]', '', 'g'),
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

