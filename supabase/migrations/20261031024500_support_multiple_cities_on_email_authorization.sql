begin;

-- Store all city memberships selected at authorization time; keep city_id as legacy primary display.
alter table public.authorized_emails
  add column if not exists city_ids uuid[] not null default array[]::uuid[];

update public.authorized_emails
set city_ids = array[city_id]
where city_id is not null
  and coalesce(cardinality(city_ids), 0) = 0;

create or replace function public.new_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  authorized_role public.app_role;
  assigned_city_ids uuid[];
  assigned_city uuid;
begin
  select
    case when ae.role in ('operator', 'admin') then ae.role else 'pending'::public.app_role end,
    case
      when coalesce(cardinality(ae.city_ids), 0) > 0 then
        array(
          select c.id
          from unnest(ae.city_ids) requested(city_id)
          join public.cities c on c.id = requested.city_id and c.active
          order by array_position(ae.city_ids, c.id)
        )
      when ae.city_id is not null and exists(select 1 from public.cities c where c.id=ae.city_id and c.active)
        then array[ae.city_id]
      else array[]::uuid[]
    end
  into authorized_role, assigned_city_ids
  from public.authorized_emails ae
  where lower(btrim(ae.email)) = lower(btrim(coalesce(new.email, '')))
  limit 1;

  assigned_city := assigned_city_ids[1];
  insert into public.profiles(id, email, display_name, role, active_city_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(authorized_role, 'pending'::public.app_role),
    assigned_city
  )
  on conflict (id) do nothing;

  if coalesce(cardinality(assigned_city_ids), 0) > 0 and authorized_role in ('operator'::public.app_role, 'admin'::public.app_role) then
    insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
    select new.id, selected.city_id, authorized_role::text, false, null
    from unnest(assigned_city_ids) selected(city_id)
    on conflict (user_id, city_id) do update
      set role = excluded.role, is_master = false;
  end if;

  return new;
end;
$function$;


-- Replace prior city memberships only when the master explicitly selects the full access set.
create or replace function public.master_replace_user_cities(p_user_id uuid, p_city_ids uuid[], p_role text)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  requested_count integer;
  active_count integer;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode atribuir cidades.' using errcode='42501';
  end if;
  if p_role not in ('operator','admin') then
    raise exception 'Perfil de cidade inválido.' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id and p.role in ('operator','admin')) then
    raise exception 'O usuário precisa ter concluído o primeiro acesso.' using errcode='22023';
  end if;
  if exists(select 1 from public.city_memberships m where m.user_id=p_user_id and m.is_master) then
    raise exception 'O administrador master não pode receber vínculo local.' using errcode='42501';
  end if;
  select count(distinct selected.city_id) into requested_count
  from unnest(coalesce(p_city_ids,array[]::uuid[])) selected(city_id);
  if requested_count=0 then raise exception 'Selecione ao menos uma cidade.' using errcode='22023'; end if;
  select count(distinct selected.city_id) into active_count
  from unnest(p_city_ids) selected(city_id)
  join public.cities c on c.id=selected.city_id and c.active;
  if active_count<>requested_count then raise exception 'Uma ou mais cidades estão indisponíveis.' using errcode='22023'; end if;

  delete from public.city_memberships m
  where m.user_id=p_user_id and not m.is_master and not (m.city_id=any(p_city_ids));

  insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
  select p_user_id,selected.city_id,p_role,false,(select auth.uid())
  from (select distinct city_id from unnest(p_city_ids) selected(city_id)) selected
  on conflict (user_id,city_id) do update
    set role=excluded.role,is_master=false,created_by=(select auth.uid()),created_at=now();

  update public.profiles p
  set active_city_id=case when p.active_city_id=any(p_city_ids) then p.active_city_id else p_city_ids[1] end
  where p.id=p_user_id;
end;
$function$;
revoke all on function public.master_replace_user_cities(uuid,uuid[],text) from public,anon;
grant execute on function public.master_replace_user_cities(uuid,uuid[],text) to authenticated;

commit;
