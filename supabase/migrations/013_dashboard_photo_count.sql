-- Fast, exact count for the Dashboard; returns only an aggregate, never person data.
create index if not exists record_photos_people_count_idx
  on public.record_photos (entity_id)
  where entity = 'people' and photo_path is not null and photo_path <> '';

-- Some older deployments still have person_photos. Keep supporting them without
-- requiring that legacy table in a clean installation.
do $$
begin
  if to_regclass('public.person_photos') is not null then
    execute 'create index if not exists person_photos_people_count_idx
      on public.person_photos (person_id)
      where photo_path is not null and photo_path <> ''''';
  end if;
end;
$$;

create or replace function public.count_people_with_photos()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;

  if to_regclass('public.person_photos') is not null then
    return (
      with photo_people as (
        select p.id
        from public.people p
        where p.archived_at is null
          and p.photo_path is not null
          and btrim(p.photo_path) <> ''
        union
        select rp.entity_id
        from public.record_photos rp
        where rp.entity = 'people'
          and rp.photo_path is not null
          and rp.photo_path <> ''
        union
        select pp.person_id
        from public.person_photos pp
        where pp.photo_path is not null
          and pp.photo_path <> ''
      )
      select count(*)
      from photo_people ph
      join public.people p on p.id = ph.id
      where p.archived_at is null
    );
  end if;

  return (
    with photo_people as (
      select p.id
      from public.people p
      where p.archived_at is null
        and p.photo_path is not null
        and btrim(p.photo_path) <> ''
      union
      select rp.entity_id
      from public.record_photos rp
      where rp.entity = 'people'
        and rp.photo_path is not null
        and rp.photo_path <> ''
    )
    select count(*)
    from photo_people ph
    join public.people p on p.id = ph.id
    where p.archived_at is null
  );
end;
$$;

revoke all on function public.count_people_with_photos() from public, anon;
grant execute on function public.count_people_with_photos() to authenticated;
