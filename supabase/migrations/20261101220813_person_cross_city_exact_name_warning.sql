create or replace function public.person_other_city_matches_v2(p_person_id uuid)
returns table(city_name text, match_type text)
language sql
stable
security definer
set search_path to ''
as $function$
  with source_person as (
    select
      person.id,
      person.city_id,
      person.cpf_digits,
      regexp_replace(
        lower(extensions.unaccent(trim(coalesce(person.full_name, '')))),
        '[[:space:]]+',
        ' ',
        'g'
      ) as normalized_name
    from public.people as person
    where person.id = p_person_id
      and person.archived_at is null
      and auth.uid() is not null
      and public.can_use_app()
      and public.can_access_city(person.city_id)
  ),
  matches as (
    select
      city.name as city_name,
      case
        when source_person.cpf_digits ~ '^[0-9]{11}$'
          and other_person.cpf_digits = source_person.cpf_digits
          then 'cpf'
        else 'name'
      end as match_type
    from source_person
    join public.people as other_person
      on other_person.city_id <> source_person.city_id
     and other_person.archived_at is null
    join public.cities as city on city.id = other_person.city_id
    where
      (
        source_person.cpf_digits ~ '^[0-9]{11}$'
        and other_person.cpf_digits = source_person.cpf_digits
      )
      or
      (
        char_length(source_person.normalized_name) >= 8
        and source_person.normalized_name ~ '[[:space:]]'
        and regexp_replace(
          lower(extensions.unaccent(trim(coalesce(other_person.full_name, '')))),
          '[[:space:]]+',
          ' ',
          'g'
        ) = source_person.normalized_name
      )
  )
  select
    matches.city_name,
    case when bool_or(matches.match_type = 'cpf') then 'cpf' else 'name' end as match_type
  from matches
  group by matches.city_name
  order by matches.city_name
$function$;

revoke all on function public.person_other_city_matches_v2(uuid) from public, anon;
grant execute on function public.person_other_city_matches_v2(uuid) to authenticated;
