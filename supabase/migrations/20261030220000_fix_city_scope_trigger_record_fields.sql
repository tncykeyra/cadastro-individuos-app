create or replace function public.enforce_city_row_scope()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_row jsonb;
  v_city uuid;
begin
  if (select auth.uid()) is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_city := nullif(v_row->>'city_id','')::uuid;
  if not public.can_access_city(v_city) then
    raise exception 'A conta só pode consultar e alterar registros da cidade atribuída.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and not public.can_access_city((to_jsonb(old)->>'city_id')::uuid) then
    raise exception 'O registro pertence a outra cidade.' using errcode='42501';
  end if;
  if tg_op<>'DELETE' then
    if tg_table_name='person_vehicle_links' and exists(
      select 1 from public.people p join public.vehicles v on v.id=(v_row->>'vehicle_id')::uuid
      where p.id=(v_row->>'person_id')::uuid and (p.city_id<>v_city or v.city_id<>v_city)
    ) then raise exception 'Não é permitido associar cadastros de cidades diferentes.' using errcode='23514'; end if;
    if tg_table_name='person_photos' and not exists(
      select 1 from public.people p where p.id=(v_row->>'person_id')::uuid and p.city_id=v_city
    ) then raise exception 'A fotografia deve pertencer a um indivíduo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='vehicle_photos' and not exists(
      select 1 from public.vehicles v where v.id=(v_row->>'vehicle_id')::uuid and v.city_id=v_city
    ) then raise exception 'A fotografia deve pertencer a um veículo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='record_photos' and (
      ((v_row->>'entity')='people' and not exists(select 1 from public.people p where p.id=(v_row->>'entity_id')::uuid and p.city_id=v_city))
      or ((v_row->>'entity')='vehicles' and not exists(select 1 from public.vehicles v where v.id=(v_row->>'entity_id')::uuid and v.city_id=v_city))
    ) then raise exception 'A fotografia deve pertencer a um cadastro da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_documents' and not exists(
      select 1 from public.arrest_warrants w where w.id=(v_row->>'warrant_id')::uuid and w.city_id=v_city
    ) then raise exception 'O PDF deve pertencer a um mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_matches' and (
      not exists(select 1 from public.arrest_warrants w where w.id=(v_row->>'warrant_id')::uuid and w.city_id=v_city)
      or ((v_row->>'person_id') is not null and not exists(select 1 from public.people p where p.id=(v_row->>'person_id')::uuid and p.city_id=v_city))
    ) then raise exception 'A correspondência deve ligar registros da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_person_proposals' and not exists(
      select 1 from public.arrest_warrants w where w.id=(v_row->>'warrant_id')::uuid and w.city_id=v_city
    ) then raise exception 'A proposta deve pertencer a um mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_duplicate_submissions' and (v_row->>'matched_warrant_id') is not null and not exists(
      select 1 from public.arrest_warrants w where w.id=(v_row->>'matched_warrant_id')::uuid and w.city_id=v_city
    ) then raise exception 'A revisão de duplicidade deve pertencer à mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_events' and (v_row->>'warrant_id') is not null and not exists(
      select 1 from public.arrest_warrants w where w.id=(v_row->>'warrant_id')::uuid and w.city_id=v_city
    ) then raise exception 'O histórico deve pertencer ao mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='person_identity_change_proposals' and not exists(
      select 1 from public.people p where p.id=(v_row->>'person_id')::uuid and p.city_id=v_city
    ) then raise exception 'A sugestão deve pertencer a um indivíduo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='vehicle_plate_change_proposals' and not exists(
      select 1 from public.vehicles v where v.id=(v_row->>'vehicle_id')::uuid and v.city_id=v_city
    ) then raise exception 'A sugestão deve pertencer a um veículo da mesma cidade.' using errcode='23514'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;