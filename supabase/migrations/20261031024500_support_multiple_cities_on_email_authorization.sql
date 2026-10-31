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

commit;
