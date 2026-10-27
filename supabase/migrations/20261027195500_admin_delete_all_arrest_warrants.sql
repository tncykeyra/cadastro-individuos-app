create or replace function public.admin_delete_all_arrest_warrants()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted_count integer := 0;
  v_storage_paths text[] := array[]::text[];
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem excluir mandados.';
  end if;

  perform id
    from public.arrest_warrants
   for update;

  select count(*)::integer
    into v_deleted_count
    from public.arrest_warrants;

  select coalesce(array_agg(distinct d.storage_path) filter (where d.storage_path is not null), array[]::text[])
    into v_storage_paths
    from public.arrest_warrant_documents d;

  insert into public.arrest_warrant_events
    (warrant_id, warrant_number, actor_id, action, detail)
  select null,
         w.warrant_number,
         auth.uid(),
         'warrant_deleted',
         jsonb_build_object(
           'status', w.status,
           'source_agency', w.source_agency,
           'source_kind', w.source_kind,
           'attached_pdf_count', coalesce(documents.document_count, 0),
           'bulk_delete', true
         )
    from public.arrest_warrants w
    left join lateral (
      select count(*)::integer as document_count
        from public.arrest_warrant_documents d
       where d.warrant_id = w.id
    ) documents on true;

  delete from public.arrest_warrant_matches
   where warrant_id in (select id from public.arrest_warrants);

  delete from public.arrest_warrant_person_proposals
   where warrant_id in (select id from public.arrest_warrants);

  delete from public.arrest_warrant_documents
   where warrant_id in (select id from public.arrest_warrants);

  update public.arrest_warrant_events e
     set warrant_number = coalesce(e.warrant_number, w.warrant_number),
         warrant_id = null
    from public.arrest_warrants w
   where e.warrant_id = w.id;

  delete from public.arrest_warrants;

  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'storage_paths', to_jsonb(v_storage_paths)
  );
end;
$function$;

revoke all on function public.admin_delete_all_arrest_warrants() from public, anon;
grant execute on function public.admin_delete_all_arrest_warrants() to authenticated;
