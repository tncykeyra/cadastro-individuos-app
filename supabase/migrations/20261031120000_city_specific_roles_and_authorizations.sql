begin;

-- An account may work in several cities with a distinct local role in each.
-- The previous index is removed only if it exists; membership rows remain intact.
drop index if exists public.city_memberships_one_city_per_user;

alter table public.authorized_emails
  add column if not exists city_roles jsonb not null default '[]'::jsonb;

-- Preserve existing authorizations by assigning their current role to each city.
update public.authorized_emails ae
set city_roles = coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'city_id', c.id,
      'role', case when ae.role::text = 'admin' then 'admin' else 'operator' end
    ) order by requested.ordinality
  )
  from unnest(coalesce(ae.city_ids, array[]::uuid[])) with ordinality requested(city_id, ordinality)
  join public.cities c on c.id = requested.city_id and c.active
), '[]'::jsonb)
where coalesce(jsonb_array_length(ae.city_roles), 0) = 0;

create or replace function public.master_replace_user_city_roles(
  p_user_id uuid,
  p_city_roles jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requested_count integer;
  v_distinct_count integer;
  v_active_count integer;
  v_city_ids uuid[];
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode atribuir cidades.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.profiles p
    where p.id = p_user_id and p.role in ('operator','admin')
  ) then
    raise exception 'O usuário precisa ter concluído o primeiro acesso.' using errcode='22023';
  end if;
  if exists(
    select 1 from public.city_memberships m
    where m.user_id = p_user_id and m.is_master
  ) then
    raise exception 'O administrador master não pode receber vínculo local.' using errcode='42501';
  end if;
  if p_city_roles is null or jsonb_typeof(p_city_roles) <> 'array' then
    raise exception 'Informe os perfis de acesso por cidade.' using errcode='22023';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_city_roles) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value->>'role','') not in ('operator','admin')
       or coalesce(item.value->>'city_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Cada cidade precisa ter um perfil válido.' using errcode='22023';
  end if;

  select count(*), count(distinct (item.value->>'city_id')::uuid)
  into v_requested_count, v_distinct_count
  from jsonb_array_elements(p_city_roles) item(value);
  if v_requested_count = 0 then
    raise exception 'Selecione ao menos uma cidade.' using errcode='22023';
  end if;
  if v_requested_count <> v_distinct_count then
    raise exception 'Uma cidade foi selecionada mais de uma vez.' using errcode='22023';
  end if;

  select array_agg((item.value->>'city_id')::uuid order by item.ordinality)
  into v_city_ids
  from jsonb_array_elements(p_city_roles) with ordinality item(value, ordinality);

  select count(*)
  into v_active_count
  from jsonb_array_elements(p_city_roles) item(value)
  join public.cities c on c.id = (item.value->>'city_id')::uuid and c.active;
  if v_active_count <> v_requested_count then
    raise exception 'Uma ou mais cidades estão indisponíveis.' using errcode='22023';
  end if;

  delete from public.city_memberships m
  where m.user_id = p_user_id
    and not m.is_master
    and not (m.city_id = any(v_city_ids));

  insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
  select p_user_id,
         (item.value->>'city_id')::uuid,
         item.value->>'role',
         false,
         (select auth.uid())
  from jsonb_array_elements(p_city_roles) item(value)
  on conflict (user_id, city_id) do update
    set role = excluded.role,
        is_master = false,
        created_by = (select auth.uid()),
        created_at = now();

  update public.profiles p
  set active_city_id = case
    when p.active_city_id = any(v_city_ids) then p.active_city_id
    else v_city_ids[1]
  end
  where p.id = p_user_id;
end;
$function$;

alter function public.master_replace_user_city_roles(uuid, jsonb) owner to postgres;
revoke all on function public.master_replace_user_city_roles(uuid, jsonb) from public, anon;
grant execute on function public.master_replace_user_city_roles(uuid, jsonb) to authenticated;

create or replace function public.new_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  authorized_role public.app_role;
  assigned_city_ids uuid[];
  assigned_city uuid;
  assigned_city_roles jsonb;
begin
  select
    case when ae.role in ('operator', 'admin') then ae.role else 'pending'::public.app_role end,
    coalesce(ae.city_roles, '[]'::jsonb),
    coalesce(ae.city_ids, array[]::uuid[])
  into authorized_role, assigned_city_roles, assigned_city_ids
  from public.authorized_emails ae
  where lower(btrim(ae.email)) = lower(btrim(coalesce(new.email, '')))
  limit 1;

  if jsonb_typeof(assigned_city_roles) = 'array' and jsonb_array_length(assigned_city_roles) > 0 then
    select array_agg(c.id order by requested.ordinality)
    into assigned_city_ids
    from jsonb_array_elements(assigned_city_roles) with ordinality requested(value, ordinality)
    join public.cities c on c.id = (requested.value->>'city_id')::uuid and c.active
    where requested.value->>'role' in ('operator','admin');
  else
    select array_agg(c.id order by array_position(assigned_city_ids, c.id))
    into assigned_city_ids
    from public.cities c
    where c.id = any(coalesce(assigned_city_ids, array[]::uuid[])) and c.active;
  end if;

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

  if jsonb_typeof(assigned_city_roles) = 'array' and jsonb_array_length(assigned_city_roles) > 0 then
    insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
    select new.id, c.id, requested.value->>'role', false, null
    from jsonb_array_elements(assigned_city_roles) requested(value)
    join public.cities c on c.id = (requested.value->>'city_id')::uuid and c.active
    where requested.value->>'role' in ('operator','admin')
    on conflict (user_id, city_id) do update
      set role = excluded.role, is_master = false;
  elsif coalesce(cardinality(assigned_city_ids), 0) > 0
        and authorized_role in ('operator'::public.app_role, 'admin'::public.app_role) then
    insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
    select new.id, selected.city_id, authorized_role::text, false, null
    from unnest(assigned_city_ids) selected(city_id)
    on conflict (user_id, city_id) do update
      set role = excluded.role, is_master = false;
  end if;

  return new;
end;
$function$;

alter function public.new_profile_for_auth_user() owner to postgres;


-- The Users page changes the account's base role. City-specific roles remain
-- authoritative for local permissions and are intentionally preserved.
create or replace function public.master_set_user_account_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode alterar o perfil base.' using errcode='42501';
  end if;
  if p_role not in ('operator', 'admin') then
    raise exception 'Perfil base inválido.' using errcode='22023';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Não é permitido alterar o próprio perfil.' using errcode='42501';
  end if;

  select lower(btrim(p.email))
    into v_email
  from public.profiles p
  where p.id = p_user_id and p.role in ('operator', 'admin', 'pending');
  if v_email is null then
    raise exception 'Usuário não encontrado ou desativado.' using errcode='22023';
  end if;

  update public.profiles
  set role = p_role::public.app_role, updated_at = now()
  where id = p_user_id;

  insert into public.authorized_emails(email, role)
  values (v_email, p_role::public.app_role)
  on conflict (email) do update
    set role = excluded.role;

  insert into public.audit_events(actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'account_role_changed:' || p_role, 'profile', p_user_id);
end;
$function$;

alter function public.master_set_user_account_role(uuid, text) owner to postgres;
revoke all on function public.master_set_user_account_role(uuid, text) from public, anon;
grant execute on function public.master_set_user_account_role(uuid, text) to authenticated;

commit;
