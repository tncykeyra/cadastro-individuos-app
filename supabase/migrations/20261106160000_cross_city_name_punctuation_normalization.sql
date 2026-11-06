-- Allow an authenticated operator to inspect only a person who exactly matches
-- a record in a city they can access. This does not broaden table RLS or city
-- membership and exposes no list/search endpoint for other-city records.

create or replace function public.person_other_city_match_cards_v1(p_person_id uuid)
returns table(
  matched_person_id uuid,
  city_name text,
  match_type text,
  full_name text,
  cpf_digits text,
  rg text,
  birthday date
)
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
        regexp_replace(
          lower(extensions.unaccent(trim(coalesce(person.full_name, '')))),
          '[^[:alnum:]]+', ' ', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      ) as normalized_name
    from public.people as person
    where person.id = p_person_id
      and person.archived_at is null
      and auth.uid() is not null
      and public.can_use_app()
      and public.can_access_city(person.city_id)
  )
  select
    target.id,
    city.name,
    case
      when source.cpf_digits ~ '^[0-9]{11}$'
       and target.cpf_digits = source.cpf_digits then 'cpf'
      else 'name'
    end,
    target.full_name,
    target.cpf_digits,
    target.rg,
    target.birthday
  from source_person as source
  join public.people as target
    on target.city_id <> source.city_id
   and target.archived_at is null
   and target.id <> source.id
  join public.cities as city on city.id = target.city_id
  where
    (source.cpf_digits ~ '^[0-9]{11}$' and target.cpf_digits = source.cpf_digits)
    or (
      char_length(source.normalized_name) >= 8
      and source.normalized_name ~ '[[:space:]]'
      and not (
        source.cpf_digits ~ '^[0-9]{11}$'
        and target.cpf_digits ~ '^[0-9]{11}$'
        and target.cpf_digits <> source.cpf_digits
      )
      and regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(trim(coalesce(target.full_name, '')))),
          '[^[:alnum:]]+', ' ', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      ) = source.normalized_name
    )
  order by city.name, target.full_name, target.id
$function$;

create or replace function public.person_other_city_detail_v1(
  p_source_person_id uuid,
  p_target_person_id uuid
)
returns table(
  person_id uuid,
  city_name text,
  match_type text,
  full_name text,
  cpf_digits text,
  rg text,
  registration text,
  alias text,
  birthday date,
  address_primary text,
  address_secondary text,
  additional_addresses text[],
  notes text,
  occurrence_notes text,
  occurrence_reference text,
  characteristics text,
  created_at timestamptz,
  updated_at timestamptz
)
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
        regexp_replace(
          lower(extensions.unaccent(trim(coalesce(person.full_name, '')))),
          '[^[:alnum:]]+', ' ', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      ) as normalized_name
    from public.people as person
    where person.id = p_source_person_id
      and person.archived_at is null
      and auth.uid() is not null
      and public.can_use_app()
      and public.can_access_city(person.city_id)
  )
  select
    target.id,
    city.name,
    case
      when source.cpf_digits ~ '^[0-9]{11}$'
       and target.cpf_digits = source.cpf_digits then 'cpf'
      else 'name'
    end,
    target.full_name,
    target.cpf_digits,
    target.rg,
    target.registration,
    target.alias,
    target.birthday,
    target.address_primary,
    target.address_secondary,
    target.additional_addresses,
    target.notes,
    target.occurrence_notes,
    target.occurrence_reference,
    to_jsonb(target)->>'characteristics',
    target.created_at,
    target.updated_at
  from source_person as source
  join public.people as target
    on target.id = p_target_person_id
   and target.city_id <> source.city_id
   and target.archived_at is null
   and target.id <> source.id
  join public.cities as city on city.id = target.city_id
  where
    (source.cpf_digits ~ '^[0-9]{11}$' and target.cpf_digits = source.cpf_digits)
    or (
      char_length(source.normalized_name) >= 8
      and source.normalized_name ~ '[[:space:]]'
      and not (
        source.cpf_digits ~ '^[0-9]{11}$'
        and target.cpf_digits ~ '^[0-9]{11}$'
        and target.cpf_digits <> source.cpf_digits
      )
      and regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(trim(coalesce(target.full_name, '')))),
          '[^[:alnum:]]+', ' ', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      ) = source.normalized_name
    )
  limit 1
$function$;

revoke all on function public.person_other_city_match_cards_v1(uuid) from public, anon;
revoke all on function public.person_other_city_detail_v1(uuid, uuid) from public, anon;
grant execute on function public.person_other_city_match_cards_v1(uuid) to authenticated;
grant execute on function public.person_other_city_detail_v1(uuid, uuid) to authenticated;

