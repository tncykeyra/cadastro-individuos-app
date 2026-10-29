-- Field-by-field, admin-only merge for duplicate individuals.
-- Archives the secondary row and preserves the complete source snapshot, files, and relationships.
create or replace function public.admin_merge_people_with_choices(
  p_primary_id uuid,
  p_duplicate_id uuid,
  p_field_choices jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary public.people%rowtype;
  v_source public.people%rowtype;
  v_after public.people%rowtype;
  v_cpf_primary text;
  v_cpf_source text;
  v_choice text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso exclusivo para administradores' using errcode='42501';
  end if;
  if p_primary_id is null or p_duplicate_id is null or p_primary_id=p_duplicate_id then
    raise exception 'Selecione dois cadastros diferentes' using errcode='22023';
  end if;
  if p_field_choices is null or jsonb_typeof(p_field_choices)<>'object' then
    raise exception 'Escolhas de campos inválidas' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('people-merge:'||least(p_primary_id,p_duplicate_id)::text||':'||greatest(p_primary_id,p_duplicate_id)::text,0));
  select * into v_primary from public.people where id=p_primary_id and archived_at is null for update;
  select * into v_source from public.people where id=p_duplicate_id and archived_at is null for update;
  if v_primary.id is null or v_source.id is null then
    raise exception 'Os dois indivíduos precisam estar ativos' using errcode='22023';
  end if;

  v_cpf_primary:=regexp_replace(coalesce(v_primary.cpf_digits,''),'[^0-9]','','g');
  v_cpf_source:=regexp_replace(coalesce(v_source.cpf_digits,''),'[^0-9]','','g');
  if length(v_cpf_primary)<>11 or v_cpf_primary<>v_cpf_source then
    raise exception 'A união de indivíduos exige CPF idêntico com 11 dígitos nos dois cadastros' using errcode='22023';
  end if;

  insert into public.record_revisions(actor_id,action,entity,entity_id,before_data,after_data,occurred_at)
  values(auth.uid(),'duplicate_merge_before','people',p_primary_id,to_jsonb(v_primary),to_jsonb(v_source),now());

  v_choice:=coalesce(p_field_choices->>'full_name','primary');
  update public.people p set
    full_name=case when v_choice='duplicate' then v_source.full_name else v_primary.full_name end,
    cpf_digits=v_primary.cpf_digits,
    rg=case when coalesce(p_field_choices->>'rg','primary')='duplicate' and nullif(v_source.rg,'') is not null then v_source.rg else coalesce(nullif(v_primary.rg,''),nullif(v_source.rg,''),'') end,
    registration=case when coalesce(p_field_choices->>'registration','primary')='duplicate' and nullif(v_source.registration,'') is not null then v_source.registration else coalesce(nullif(v_primary.registration,''),nullif(v_source.registration,''),'') end,
    alias=case when coalesce(p_field_choices->>'alias','primary')='duplicate' and nullif(v_source.alias,'') is not null then v_source.alias else coalesce(nullif(v_primary.alias,''),nullif(v_source.alias,''),'') end,
    birthday=case when coalesce(p_field_choices->>'birthday','primary')='duplicate' and v_source.birthday is not null then v_source.birthday else coalesce(v_primary.birthday,v_source.birthday) end,
    address_primary=case when coalesce(p_field_choices->>'address_primary','primary')='duplicate' and nullif(v_source.address_primary,'') is not null then v_source.address_primary else coalesce(nullif(v_primary.address_primary,''),nullif(v_source.address_primary,''),'') end,
    address_secondary=case when coalesce(p_field_choices->>'address_secondary','primary')='duplicate' and nullif(v_source.address_secondary,'') is not null then v_source.address_secondary else coalesce(nullif(v_primary.address_secondary,''),nullif(v_source.address_secondary,''),'') end,
    notes=case when nullif(v_source.notes,'') is null or position(v_source.notes in coalesce(v_primary.notes,''))>0 then coalesce(v_primary.notes,'') when nullif(v_primary.notes,'') is null then v_source.notes else v_primary.notes||E'\\n\\n'||v_source.notes end,
    occurrence_notes=case when coalesce(p_field_choices->>'occurrence_notes','primary')='duplicate' and nullif(v_source.occurrence_notes,'') is not null then v_source.occurrence_notes when nullif(v_primary.occurrence_notes,'') is null then coalesce(v_source.occurrence_notes,'') else v_primary.occurrence_notes end,
    occurrence_reference=case when coalesce(p_field_choices->>'occurrence_reference','primary')='duplicate' and nullif(v_source.occurrence_reference,'') is not null then v_source.occurrence_reference else coalesce(nullif(v_primary.occurrence_reference,''),nullif(v_source.occurrence_reference,''),'') end,
    characteristics=case when coalesce(p_field_choices->>'characteristics','primary')='duplicate' and nullif(v_source.characteristics,'') is not null then v_source.characteristics else coalesce(nullif(v_primary.characteristics,''),nullif(v_source.characteristics,''),'') end,
    photo_path=coalesce(v_primary.photo_path,v_source.photo_path),
    photo_paths=(select coalesce(array_agg(distinct path),'{}') from unnest(coalesce(v_primary.photo_paths,'{}')||coalesce(v_source.photo_paths,'{}')||array_remove(array[v_primary.photo_path,v_source.photo_path],null)) path),
    additional_addresses=(select coalesce(array_agg(distinct addr),'{}') from unnest(coalesce(v_primary.additional_addresses,'{}')||coalesce(v_source.additional_addresses,'{}')) addr),
    updated_at=now(),updated_by=auth.uid()
  where p.id=p_primary_id
  returning p.* into v_after;

  update public.person_photos d set person_id=p_primary_id
  where d.person_id=p_duplicate_id and not exists(select 1 from public.person_photos p where p.photo_path=d.photo_path);
  update public.record_photos set is_cover=false where entity='people' and entity_id=p_duplicate_id;
  update public.record_photos d set entity_id=p_primary_id,is_cover=false
  where d.entity='people' and d.entity_id=p_duplicate_id
    and not exists(select 1 from public.record_photos p where p.photo_path=d.photo_path);

  update public.person_vehicle_links d set active=false
    from public.person_vehicle_links p
    where d.person_id=p_duplicate_id and p.person_id=p_primary_id and d.vehicle_id=p.vehicle_id and d.relation=p.relation and d.active and p.active;
  update public.person_vehicle_links d set person_id=p_primary_id
    where d.person_id=p_duplicate_id and d.active
      and not exists(select 1 from public.person_vehicle_links p where p.person_id=p_primary_id and p.vehicle_id=d.vehicle_id and p.relation=d.relation and p.active);

  update public.arrest_warrant_person_proposals set resulting_person_id=p_primary_id where resulting_person_id=p_duplicate_id;
  update public.arrest_warrant_matches d set person_id=p_primary_id
    where d.person_id=p_duplicate_id
      and not exists(select 1 from public.arrest_warrant_matches p where p.person_id=p_primary_id and p.warrant_id=d.warrant_id);

  update public.people set archived_at=now(),updated_at=now(),updated_by=auth.uid() where id=p_duplicate_id and archived_at is null;
  if not found then raise exception 'O cadastro secundário não está ativo' using errcode='22023'; end if;

  insert into public.record_revisions(actor_id,action,entity,entity_id,before_data,after_data,occurred_at)
  values(auth.uid(),'duplicate_merge_after','people',p_primary_id,to_jsonb(v_primary),to_jsonb(v_after),now());
  insert into public.duplicate_record_reviews(entity,left_id,right_id,decision,primary_id,decided_by,decided_at)
  values('people',least(p_primary_id,p_duplicate_id),greatest(p_primary_id,p_duplicate_id),'merge',p_primary_id,auth.uid(),now())
  on conflict(entity,left_id,right_id) do update set decision='merge',primary_id=p_primary_id,decided_by=auth.uid(),decided_at=now();
  insert into public.audit_events(actor_id,action,entity,entity_id,occurred_at)
  values(auth.uid(),'duplicate_merge','people',p_primary_id,now());
  return jsonb_build_object('decision','merge','primary_id',p_primary_id,'archived_id',p_duplicate_id);
end;
$$;
revoke all on function public.admin_merge_people_with_choices(uuid,uuid,jsonb) from public,anon;
grant execute on function public.admin_merge_people_with_choices(uuid,uuid,jsonb) to authenticated;
