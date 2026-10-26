alter table public.arrest_warrants
  add column process_number_digits text generated always as (
    case
      when source_reference ~ '[0-9]{7}[[:space:]]*-[[:space:]]*[0-9]{2}[[:space:]]*[.][[:space:]]*[0-9]{4}[[:space:]]*[.][[:space:]]*[0-9][[:space:]]*[.][[:space:]]*[0-9]{2}[[:space:]]*[.][[:space:]]*[0-9]{4}'
        then regexp_replace(
          (regexp_match(source_reference, '([0-9]{7}[[:space:]]*-[[:space:]]*[0-9]{2}[[:space:]]*[.][[:space:]]*[0-9]{4}[[:space:]]*[.][[:space:]]*[0-9][[:space:]]*[.][[:space:]]*[0-9]{2}[[:space:]]*[.][[:space:]]*[0-9]{4})'))[1],
          '[^0-9]', '', 'g'
        )
      when source_reference ~ '^[[:space:]]*[0-9]{20}[[:space:]]*$'
        then regexp_replace(source_reference, '[^0-9]', '', 'g')
      else null
    end
  ) stored;

do $$
begin
  if exists (
    select process_number_digits
    from public.arrest_warrants
    where process_number_digits is not null
    group by process_number_digits
    having count(*) > 1
  ) then
    raise exception 'Há mandados com números de processo repetidos; não foi criada a restrição de unicidade.';
  end if;
end;
$$;

create unique index arrest_warrants_process_number_digits_uidx
  on public.arrest_warrants (process_number_digits)
  where process_number_digits is not null;

grant select (process_number_digits)
  on table public.arrest_warrants to authenticated;

alter table public.arrest_warrant_events
  add column warrant_number text;

alter table public.arrest_warrant_events
  alter column warrant_id drop not null;

create or replace function public.admin_delete_arrest_warrant(p_warrant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_warrant public.arrest_warrants%rowtype;
  v_storage_paths text[] := array[]::text[];
  v_document_count integer := 0;
begin
  if auth.uid() is null or public.is_admin() is not true then
    raise exception 'Apenas administradores podem excluir mandados.';
  end if;

  select *
    into v_warrant
    from public.arrest_warrants
   where id = p_warrant_id
   for update;

  if not found then
    raise exception 'Mandado não encontrado.';
  end if;

  select coalesce(array_agg(d.storage_path), array[]::text[]), count(*)::integer
    into v_storage_paths, v_document_count
    from public.arrest_warrant_documents d
   where d.warrant_id = p_warrant_id;

  insert into public.arrest_warrant_events
    (warrant_id, warrant_number, actor_id, action, detail)
  values
    (null, v_warrant.warrant_number, auth.uid(), 'warrant_deleted',
     jsonb_build_object(
       'status', v_warrant.status,
       'source_agency', v_warrant.source_agency,
       'source_kind', v_warrant.source_kind,
       'attached_pdf_count', v_document_count
     ));

  delete from public.arrest_warrant_matches
   where warrant_id = p_warrant_id;

  delete from public.arrest_warrant_person_proposals
   where warrant_id = p_warrant_id;

  delete from public.arrest_warrant_documents
   where warrant_id = p_warrant_id;

  update public.arrest_warrant_events
     set warrant_number = coalesce(warrant_number, v_warrant.warrant_number),
         warrant_id = null
   where warrant_id = p_warrant_id;

  delete from public.arrest_warrants
   where id = p_warrant_id;

  return jsonb_build_object('storage_paths', to_jsonb(v_storage_paths));
end;
$function$;

revoke all on function public.admin_delete_arrest_warrant(uuid) from public, anon;
grant execute on function public.admin_delete_arrest_warrant(uuid) to authenticated;