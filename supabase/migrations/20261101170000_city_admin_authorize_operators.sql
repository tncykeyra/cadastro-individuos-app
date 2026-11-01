begin;

-- Allow a city administrator to authorize an operator only in the active city.
-- The function preserves existing roles and memberships in every other city.
create or replace function public.admin_authorize_city_operator(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_city_id uuid;
  v_city_active boolean;
  v_base_role public.app_role;
  v_existing_city_id uuid;
  v_existing_city_ids uuid[];
  v_city_roles jsonb;
  v_profile_id uuid;
  v_profile_role public.app_role;
  v_has_city_assignment boolean;
  v_membership_role text;
  v_master_membership boolean;
  v_role_item jsonb;
  v_legacy_city_id uuid;
  v_city_ids uuid[];
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Somente administradores locais podem autorizar operadores.' using errcode='42501';
  end if;

  v_city_id := public.current_city_id();
  if v_city_id is null or not public.can_manage_city(v_city_id) then
    raise exception 'Não foi possível confirmar a cidade administrada.' using errcode='42501';
  end if;

  select c.active into v_city_active
  from public.cities c
  where c.id = v_city_id;
  if coalesce(v_city_active, false) is not true then
    raise exception 'A cidade ativa está indisponível.' using errcode='22023';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode='22023';
  end if;

  -- Serialize invitations for the same email so simultaneous city admins do
  -- not overwrite each other's city assignments.
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

  select ae.role, ae.city_id, ae.city_ids, ae.city_roles
    into v_base_role, v_existing_city_id, v_existing_city_ids, v_city_roles
  from public.authorized_emails ae
  where ae.email = v_email
  for update;

  if not found then
    insert into public.authorized_emails(email, role, city_id, city_ids, city_roles)
    values (v_email, 'operator', v_city_id, array[v_city_id], jsonb_build_array(
      jsonb_build_object('city_id', v_city_id, 'role', 'operator')
    ));
    v_base_role := 'operator';
    v_city_roles := jsonb_build_array(jsonb_build_object('city_id', v_city_id, 'role', 'operator'));
    v_existing_city_ids := array[v_city_id];
  else
    if v_city_roles is null or jsonb_typeof(v_city_roles) <> 'array' then
      raise exception 'A autorização existente precisa ser revisada pelo administrador master.' using errcode='22023';
    end if;

    -- Preserve legacy city assignments if a row predates city_roles.
    foreach v_legacy_city_id in array coalesce(v_existing_city_ids, array[]::uuid[]) || case
      when v_existing_city_id is null then array[]::uuid[] else array[v_existing_city_id] end
    loop
      if not exists(
        select 1 from jsonb_array_elements(v_city_roles) item(value)
        where item.value->>'city_id' = v_legacy_city_id::text
      ) then
        v_city_roles := v_city_roles || jsonb_build_array(jsonb_build_object(
          'city_id', v_legacy_city_id,
          'role', case when v_base_role = 'admin' then 'admin' else 'operator' end
        ));
      end if;
    end loop;

    if exists(
      select 1 from jsonb_array_elements(v_city_roles) item(value)
      where item.value->>'city_id' = v_city_id::text
        and item.value->>'role' = 'admin'
    ) then
      raise exception 'Este e-mail já é administrador desta cidade. Somente o administrador master pode alterar esse perfil.' using errcode='42501';
    end if;

    select exists(
      select 1 from jsonb_array_elements(v_city_roles) item(value)
      where item.value->>'city_id' = v_city_id::text
        and item.value->>'role' = 'operator'
    ) into v_has_city_assignment;

    if not v_has_city_assignment then
      v_city_roles := v_city_roles || jsonb_build_array(jsonb_build_object(
        'city_id', v_city_id,
        'role', 'operator'
      ));
    end if;

    select coalesce(array_agg(distinct (item.value->>'city_id')::uuid order by (item.value->>'city_id')::uuid), array[]::uuid[])
      into v_city_ids
    from jsonb_array_elements(v_city_roles) item(value)
    where coalesce(item.value->>'city_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and item.value->>'role' in ('operator','admin');

    update public.authorized_emails ae
       set city_id = coalesce(ae.city_id, v_city_id),
           city_ids = v_city_ids,
           city_roles = v_city_roles
     where ae.email = v_email;
  end if;

  select p.id, p.role
    into v_profile_id, v_profile_role
  from public.profiles p
  where lower(btrim(p.email)) = v_email
  limit 1
  for update;

  if v_profile_id is not null then
    if v_profile_role = 'disabled' then
      raise exception 'Este usuário está desativado. O administrador master precisa reativá-lo.' using errcode='42501';
    end if;

    select exists(
      select 1 from public.city_memberships m
      where m.user_id = v_profile_id and m.is_master
    ) into v_master_membership;
    if v_master_membership then
      raise exception 'O administrador master não pode receber vínculo local.' using errcode='42501';
    end if;

    select m.role into v_membership_role
    from public.city_memberships m
    where m.user_id = v_profile_id and m.city_id = v_city_id
    for update;
    if v_membership_role = 'admin' then
      raise exception 'Este usuário já é administrador desta cidade. Somente o administrador master pode alterar esse perfil.' using errcode='42501';
    end if;

    if v_profile_role = 'pending' then
      update public.profiles
         set role = 'operator', updated_at = now()
       where id = v_profile_id;
    end if;

    insert into public.city_memberships(user_id, city_id, role, is_master, created_by)
    values (v_profile_id, v_city_id, 'operator', false, (select auth.uid()))
    on conflict (user_id, city_id) do update
      set role = 'operator', is_master = false, created_by = (select auth.uid());

    update public.profiles
       set active_city_id = v_city_id
     where id = v_profile_id and active_city_id is null;
  end if;
end;
$function$;

alter function public.admin_authorize_city_operator(text) owner to postgres;
revoke all on function public.admin_authorize_city_operator(text) from public, anon;
grant execute on function public.admin_authorize_city_operator(text) to authenticated;

commit;
