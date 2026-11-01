create or replace function public.person_other_city_matches(p_person_id uuid)
returns table(city_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct city.name
  from public.people as source_person
  join public.people as other_person
    on other_person.cpf_digits = source_person.cpf_digits
   and other_person.city_id <> source_person.city_id
   and other_person.archived_at is null
  join public.cities as city on city.id = other_person.city_id
  where source_person.id = p_person_id
    and source_person.archived_at is null
    and source_person.cpf_digits ~ '^[0-9]{11}$'
    and auth.uid() is not null
    and public.can_use_app()
    and public.can_access_city(source_person.city_id)
  order by city.name
$$;

revoke all on function public.person_other_city_matches(uuid) from public, anon;
grant execute on function public.person_other_city_matches(uuid) to authenticated;
