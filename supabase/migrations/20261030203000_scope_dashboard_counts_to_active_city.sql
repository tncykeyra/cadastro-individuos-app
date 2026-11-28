-- Keep Dashboard totals scoped to the active city, including SECURITY DEFINER counters.
-- No records or access policies are changed by this migration.
create or replace function public.count_people_with_photos()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city_id uuid := public.current_city_id();
begin
  if not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;
  if v_city_id is null then
    raise exception 'Nenhuma cidade ativa selecionada.';
  end if;

  return (
    with photo_people as (
      select p.id
      from public.people p
      where p.city_id = v_city_id
        and p.archived_at is null
        and p.photo_path is not null
        and btrim(p.photo_path) <> ''
      union
      select rp.entity_id
      from public.record_photos rp
      join public.people p
        on p.id = rp.entity_id
       and p.city_id = v_city_id
       and p.archived_at is null
      where rp.city_id = v_city_id
        and rp.entity = 'people'
        and rp.photo_path is not null
        and rp.photo_path <> ''
      union
      select pp.person_id
      from public.person_photos pp
      join public.people p
        on p.id = pp.person_id
       and p.city_id = v_city_id
       and p.archived_at is null
      where pp.photo_path is not null
        and pp.photo_path <> ''
    )
    select count(*)
    from photo_people ph
    join public.people p
      on p.id = ph.id
     and p.city_id = v_city_id
    where p.archived_at is null
  );
end;
$$;

create or replace function public.count_active_arrest_warrants()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city_id uuid := public.current_city_id();
begin
  if (select auth.uid()) is null or not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;
  if v_city_id is null then
    raise exception 'Nenhuma cidade ativa selecionada.';
  end if;

  if public.is_admin() then
    return (
      select count(*)
      from public.arrest_warrants w
      where w.city_id = v_city_id
        and w.status in ('pending','discharge_reported')
    );
  end if;

  return (
    select count(distinct w.id)
    from public.arrest_warrants w
    join public.arrest_warrant_matches m
      on m.warrant_id = w.id
     and m.city_id = v_city_id
     and m.review_status = 'confirmed'
    join public.people p
      on p.id = m.person_id
     and p.city_id = v_city_id
     and p.archived_at is null
    where w.city_id = v_city_id
      and w.status in ('pending','discharge_reported')
  );
end;
$$;
