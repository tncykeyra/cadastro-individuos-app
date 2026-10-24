-- Match each word in a query independently so middle names and extra spaces do not hide results.
create or replace function public.search_people(search_term text, result_limit integer default 100)
returns setof public.people
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select extensions.unaccent(
      lower(regexp_replace(trim(coalesce(search_term, '')), '[[:space:]]+', ' ', 'g'))
    ) as term
  ),
  terms as (
    select token
    from q
    cross join lateral pg_catalog.regexp_split_to_table(q.term, ' ') as token
    where token <> ''
  )
  select p.*
  from public.people p
  cross join q
  where p.archived_at is null
    and length(q.term) >= 2
    and not exists (
      select 1
      from terms t
      where not (
        extensions.unaccent(lower(p.full_name)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.rg)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.registration)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.alias)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.address_primary)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.address_secondary)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.notes)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.occurrence_notes)) like '%' || t.token || '%'
        or extensions.unaccent(lower(p.occurrence_reference)) like '%' || t.token || '%'
        or (
          regexp_replace(t.token, '[^0-9]', '', 'g') <> ''
          and lower(coalesce(p.cpf_digits, '')) like '%' || regexp_replace(t.token, '[^0-9]', '', 'g') || '%'
        )
      )
    )
  order by p.full_name
  limit least(greatest(coalesce(result_limit, 100), 1), 100)
$$;

create or replace function public.search_vehicles(search_term text, result_limit integer default 100)
returns setof public.vehicles
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select extensions.unaccent(
      lower(regexp_replace(trim(coalesce(search_term, '')), '[[:space:]]+', ' ', 'g'))
    ) as term
  ),
  terms as (
    select token
    from q
    cross join lateral pg_catalog.regexp_split_to_table(q.term, ' ') as token
    where token <> ''
  )
  select distinct v.*
  from public.vehicles v
  cross join q
  left join public.person_vehicle_links l on l.vehicle_id = v.id and l.active = true
  left join public.people p on p.id = l.person_id and p.archived_at is null
  where v.archived_at is null
    and length(q.term) >= 2
    and not exists (
      select 1
      from terms t
      where not (
        extensions.unaccent(lower(v.plate)) like '%' || t.token || '%'
        or extensions.unaccent(lower(v.make)) like '%' || t.token || '%'
        or extensions.unaccent(lower(v.model)) like '%' || t.token || '%'
        or extensions.unaccent(lower(v.color)) like '%' || t.token || '%'
        or extensions.unaccent(lower(v.notes)) like '%' || t.token || '%'
        or extensions.unaccent(lower(coalesce(p.full_name, ''))) like '%' || t.token || '%'
        or extensions.unaccent(lower(coalesce(p.alias, ''))) like '%' || t.token || '%'
        or extensions.unaccent(lower(coalesce(p.address_primary, ''))) like '%' || t.token || '%'
        or extensions.unaccent(lower(coalesce(p.address_secondary, ''))) like '%' || t.token || '%'
        or (
          regexp_replace(t.token, '[^0-9]', '', 'g') <> ''
          and lower(coalesce(p.cpf_digits, '')) like '%' || regexp_replace(t.token, '[^0-9]', '', 'g') || '%'
        )
      )
    )
  order by v.plate
  limit least(greatest(coalesce(result_limit, 100), 1), 100)
$$;

revoke all on function public.search_people(text, integer), public.search_vehicles(text, integer) from public, anon;
grant execute on function public.search_people(text, integer), public.search_vehicles(text, integer) to authenticated;
