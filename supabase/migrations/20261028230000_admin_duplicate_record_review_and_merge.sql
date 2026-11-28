-- Admin-only duplicate review. Merging archives the secondary record; it never deletes the record or Storage objects.
create table if not exists public.duplicate_record_reviews (
  entity text not null check (entity in ('people','vehicles')),
  left_id uuid not null,
  right_id uuid not null,
  decision text not null check (decision in ('separate','merge')),
  primary_id uuid,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  constraint duplicate_record_reviews_pair_order check (left_id::text < right_id::text),
  constraint duplicate_record_reviews_pkey primary key (entity,left_id,right_id)
);
alter table public.duplicate_record_reviews enable row level security;
drop policy if exists duplicate_record_reviews_admin_read on public.duplicate_record_reviews;
create policy duplicate_record_reviews_admin_read on public.duplicate_record_reviews
  for select to authenticated using (public.is_admin());
revoke all on public.duplicate_record_reviews from anon, authenticated;
grant select on public.duplicate_record_reviews to authenticated;

create or replace function public.admin_review_duplicate_records(
  p_entity text, p_primary_id uuid, p_duplicate_id uuid, p_decision text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left uuid;
  v_right uuid;
  v_source_cpf text;
  v_primary_cpf text;
  v_source_plate text;
  v_primary_plate text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso exclusivo para administradores' using errcode = '42501';
  end if;
  if p_entity is null or p_decision is null or p_entity not in ('people','vehicles') or p_decision not in ('separate','merge')
     or p_primary_id is null or p_duplicate_id is null or p_primary_id = p_duplicate_id then
    raise exception 'Parâmetros de revisão inválidos' using errcode = '22023';
  end if;
  v_left := least(p_primary_id,p_duplicate_id);
  v_right := greatest(p_primary_id,p_duplicate_id);
  perform pg_advisory_xact_lock(hashtextextended(p_entity||':'||v_left::text||':'||v_right::text,0));

  if p_decision = 'separate' then
    insert into public.duplicate_record_reviews(entity,left_id,right_id,decision,primary_id,decided_by,decided_at)
    values(p_entity,v_left,v_right,'separate',null,auth.uid(),now())
    on conflict(entity,left_id,right_id) do update set decision='separate',primary_id=null,decided_by=auth.uid(),decided_at=now();
    return jsonb_build_object('decision','separate');
  end if;

  if p_entity = 'people' then
    perform 1 from public.people where id in (p_primary_id,p_duplicate_id) order by id for update;
    select regexp_replace(coalesce(cpf_digits,''),'[^0-9]','','g') into v_primary_cpf from public.people where id=p_primary_id and archived_at is null;
    select regexp_replace(coalesce(cpf_digits,''),'[^0-9]','','g') into v_source_cpf from public.people where id=p_duplicate_id and archived_at is null;
    if v_primary_cpf is null or length(v_primary_cpf)<>11 or v_primary_cpf<>v_source_cpf then
      raise exception 'A junção de indivíduos exige CPF idêntico com 11 dígitos nos dois cadastros' using errcode='22023';
    end if;

    update public.people p set
      rg=coalesce(nullif(p.rg,''),nullif(d.rg,'')),
      registration=coalesce(nullif(p.registration,''),nullif(d.registration,'')),
      alias=coalesce(nullif(p.alias,''),nullif(d.alias,'')),
      birthday=coalesce(p.birthday,d.birthday),
      address_primary=coalesce(nullif(p.address_primary,''),nullif(d.address_primary,'')),
      address_secondary=coalesce(nullif(p.address_secondary,''),nullif(d.address_secondary,'')),
      notes=case when nullif(d.notes,'') is null or position(d.notes in coalesce(p.notes,''))>0 then p.notes when nullif(p.notes,'') is null then d.notes else p.notes||E'\n\n'||d.notes end,
      occurrence_notes=case when nullif(d.occurrence_notes,'') is null or position(d.occurrence_notes in coalesce(p.occurrence_notes,''))>0 then p.occurrence_notes when nullif(p.occurrence_notes,'') is null then d.occurrence_notes else p.occurrence_notes||E'\n\n'||d.occurrence_notes end,
      occurrence_reference=coalesce(nullif(p.occurrence_reference,''),nullif(d.occurrence_reference,'')),
      characteristics=coalesce(nullif(p.characteristics,''),nullif(d.characteristics,'')),
      photo_path=coalesce(p.photo_path,d.photo_path),
      photo_paths=(select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p.photo_paths,'{}')||coalesce(d.photo_paths,'{}')||array_remove(array[p.photo_path,d.photo_path],null)) x),
      additional_addresses=(select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p.additional_addresses,'{}')||coalesce(d.additional_addresses,'{}')) x),
      updated_at=now(),updated_by=auth.uid()
    from public.people d where p.id=p_primary_id and d.id=p_duplicate_id;

    update public.person_photos d set person_id=p_primary_id
      where d.person_id=p_duplicate_id and not exists(select 1 from public.person_photos p where p.photo_path=d.photo_path and p.id<>d.id);
    update public.record_photos set is_cover=false where entity='people' and entity_id=p_duplicate_id;
    update public.record_photos d set entity_id=p_primary_id,is_cover=false
      where d.entity='people' and d.entity_id=p_duplicate_id
        and not exists(select 1 from public.record_photos p where p.photo_path=d.photo_path and p.id<>d.id);

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

  else
    perform 1 from public.vehicles where id in (p_primary_id,p_duplicate_id) order by id for update;
    select regexp_replace(upper(coalesce(plate,'')),'[^A-Z0-9]','','g') into v_primary_plate from public.vehicles where id=p_primary_id and archived_at is null;
    select regexp_replace(upper(coalesce(plate,'')),'[^A-Z0-9]','','g') into v_source_plate from public.vehicles where id=p_duplicate_id and archived_at is null;
    if v_primary_plate is null or v_primary_plate='' or v_primary_plate<>v_source_plate then
      raise exception 'A junção de veículos exige a mesma placa normalizada nos dois cadastros' using errcode='22023';
    end if;

    update public.vehicles p set
      make=coalesce(nullif(p.make,''),nullif(d.make,'')),
      model=coalesce(nullif(p.model,''),nullif(d.model,'')),
      color=coalesce(nullif(p.color,''),nullif(d.color,'')),
      notes=case when nullif(d.notes,'') is null or position(d.notes in coalesce(p.notes,''))>0 then p.notes when nullif(p.notes,'') is null then d.notes else p.notes||E'\n\n'||d.notes end,
      photo_path=coalesce(p.photo_path,d.photo_path),
      photo_paths=(select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p.photo_paths,'{}')||coalesce(d.photo_paths,'{}')||array_remove(array[p.photo_path,d.photo_path],null)) x),
      updated_at=now(),updated_by=auth.uid()
    from public.vehicles d where p.id=p_primary_id and d.id=p_duplicate_id;

    update public.vehicle_photos d set vehicle_id=p_primary_id
      where d.vehicle_id=p_duplicate_id and not exists(select 1 from public.vehicle_photos p where p.photo_path=d.photo_path and p.id<>d.id);
    update public.record_photos set is_cover=false where entity='vehicles' and entity_id=p_duplicate_id;
    update public.record_photos d set entity_id=p_primary_id,is_cover=false
      where d.entity='vehicles' and d.entity_id=p_duplicate_id
        and not exists(select 1 from public.record_photos p where p.photo_path=d.photo_path and p.id<>d.id);
    update public.person_vehicle_links d set active=false
      from public.person_vehicle_links p
      where d.vehicle_id=p_duplicate_id and p.vehicle_id=p_primary_id and d.person_id=p.person_id and d.relation=p.relation and d.active and p.active;
    update public.person_vehicle_links d set vehicle_id=p_primary_id
      where d.vehicle_id=p_duplicate_id and d.active
        and not exists(select 1 from public.person_vehicle_links p where p.vehicle_id=p_primary_id and p.person_id=d.person_id and p.relation=d.relation and p.active);

    update public.vehicles set archived_at=now(),updated_at=now(),updated_by=auth.uid() where id=p_duplicate_id and archived_at is null;
    if not found then raise exception 'O veículo secundário não está ativo' using errcode='22023'; end if;
  end if;

  insert into public.duplicate_record_reviews(entity,left_id,right_id,decision,primary_id,decided_by,decided_at)
  values(p_entity,v_left,v_right,'merge',p_primary_id,auth.uid(),now())
  on conflict(entity,left_id,right_id) do update set decision='merge',primary_id=p_primary_id,decided_by=auth.uid(),decided_at=now();

  insert into public.audit_events(actor_id,action,entity,entity_id,occurred_at)
  values(auth.uid(),'duplicate_merge',p_entity,p_primary_id,now());

  return jsonb_build_object('decision','merge','primary_id',p_primary_id,'archived_id',p_duplicate_id);
end;
$$;
revoke all on function public.admin_review_duplicate_records(text,uuid,uuid,text) from public, anon;
grant execute on function public.admin_review_duplicate_records(text,uuid,uuid,text) to authenticated;
