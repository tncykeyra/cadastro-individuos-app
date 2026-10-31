begin;

-- Record the target city at authorization time. Existing authorizations remain intact.
alter table public.authorized_emails
  add column if not exists city_id uuid references public.cities(id) on delete set null;

-- Assign the authorized city as soon as a first Google login creates the profile.
create or replace function public.new_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  authorized_role public.app_role;
  assigned_city uuid;
begin
  select
    case when ae.role in ('operator', 'admin') then ae.role else 'pending'::public.app_role end,
    case when c.active then ae.city_id else null end
  into authorized_role, assigned_city
  from public.authorized_emails ae
  left join public.cities c on c.id = ae.city_id
  where lower(btrim(ae.email)) = lower(btrim(coalesce(new.email, '')))
  limit 1;

  insert into public.profiles(id, email, display_name, role, active_city_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(authorized_role, 'pending'::public.app_role),
    assigned_city
  )
  on conflict (id) do nothing;

  if assigned_city is not null and authorized_role in ('operator'::public.app_role, 'admin'::public.app_role) then
    insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
    values (new.id, assigned_city, authorized_role::text, false, null)
    on conflict (user_id, city_id) do update
      set role = excluded.role, is_master = false;
  end if;

  return new;
end;
$function$;

-- Delete only photos belonging to the authenticated user's active city and selected record.
-- Reassign the cover to another retained image without deleting any shared file.
create or replace function public.delete_record_photos(
  p_entity text,
  p_entity_id uuid,
  p_photo_paths text[]
)
returns text[]
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_city_id uuid;
  v_current_path text;
  v_cover_path text;
  v_path text;
  v_paths text[];
begin
  if (select auth.uid()) is null or not public.can_use_app() then
    raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
  if p_entity not in ('people', 'vehicles') then
    raise exception 'Tipo de cadastro inválido.' using errcode='22023';
  end if;
  v_paths := array(select distinct x from unnest(coalesce(p_photo_paths, array[]::text[])) x where x is not null and btrim(x) <> '');
  if coalesce(array_length(v_paths, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma foto.' using errcode='22023';
  end if;

  if p_entity = 'people' then
    select city_id, photo_path into v_city_id, v_current_path
      from public.people where id = p_entity_id for update;
  else
    select city_id, photo_path into v_city_id, v_current_path
      from public.vehicles where id = p_entity_id for update;
  end if;
  if not found then raise exception 'Cadastro não encontrado.' using errcode='P0002'; end if;
  if not public.can_access_city(v_city_id) then
    raise exception 'Você não tem acesso à cidade deste cadastro.' using errcode='42501';
  end if;

  foreach v_path in array v_paths loop
    if v_path is distinct from v_current_path and not exists (
      select 1 from public.record_photos rp
      where rp.entity = p_entity and rp.entity_id = p_entity_id and rp.photo_path = v_path
    ) and not (
      (p_entity = 'people' and exists(select 1 from public.person_photos pp where pp.person_id = p_entity_id and pp.photo_path = v_path))
      or
      (p_entity = 'vehicles' and exists(select 1 from public.vehicle_photos vp where vp.vehicle_id = p_entity_id and vp.photo_path = v_path))
    ) then
      raise exception 'Uma das fotos selecionadas não pertence a este cadastro.' using errcode='22023';
    end if;
  end loop;

  delete from public.record_photos
    where entity = p_entity and entity_id = p_entity_id and photo_path = any(v_paths);
  if p_entity = 'people' then
    delete from public.person_photos where person_id = p_entity_id and photo_path = any(v_paths);
  else
    delete from public.vehicle_photos where vehicle_id = p_entity_id and photo_path = any(v_paths);
  end if;

  select rp.photo_path into v_cover_path
    from public.record_photos rp
    where rp.entity = p_entity and rp.entity_id = p_entity_id
      and not (rp.photo_path = any(v_paths))
    order by rp.is_cover desc, rp.created_at asc
    limit 1;

  if v_cover_path is null and p_entity = 'people' then
    select pp.photo_path into v_cover_path from public.person_photos pp
      where pp.person_id = p_entity_id and not (pp.photo_path = any(v_paths))
      order by pp.created_at asc limit 1;
  elsif v_cover_path is null then
    select vp.photo_path into v_cover_path from public.vehicle_photos vp
      where vp.vehicle_id = p_entity_id and not (vp.photo_path = any(v_paths))
      order by vp.created_at asc limit 1;
  end if;
  if v_cover_path is null and not (v_current_path = any(v_paths)) then
    v_cover_path := v_current_path;
  end if;

  update public.record_photos
    set is_cover = (photo_path = v_cover_path)
    where entity = p_entity and entity_id = p_entity_id;

  if p_entity = 'people' then
    update public.people set photo_path = v_cover_path where id = p_entity_id;
  else
    update public.vehicles set photo_path = v_cover_path where id = p_entity_id;
  end if;

  return v_paths;
end;
$function$;

revoke all on function public.delete_record_photos(text, uuid, text[]) from public, anon;
grant execute on function public.delete_record_photos(text, uuid, text[]) to authenticated;

-- Permit authenticated staff to remove photo objects only within their city.
drop policy if exists people_photos_delete_admin_guard on storage.objects;
create policy people_photos_delete_staff_guard
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'people-photos'
    or (bucket_id = 'people-photos' and public.can_use_app() and public.can_access_city_storage_object(bucket_id, name))
  );
create policy people_photos_delete_staff
  on storage.objects as permissive for delete to authenticated
  using (
    bucket_id = 'people-photos'
    and public.can_use_app()
    and public.can_access_city_storage_object(bucket_id, name)
  );

commit;
