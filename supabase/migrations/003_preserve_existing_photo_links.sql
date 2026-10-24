-- Preserve existing photo metadata when moving to the unified gallery.
-- The private Storage bucket and its objects are left untouched.
do $migration$
begin
  if to_regclass('public.person_photos') is not null then
    execute $copy_people$
      insert into public.record_photos
        (entity, entity_id, photo_path, is_cover, crop_position, created_by, created_at)
      select
        'people',
        pp.person_id,
        pp.photo_path,
        row_number() over (
          partition by pp.person_id
          order by (pp.photo_path = p.photo_path) desc, pp.sort_order, pp.created_at, pp.id
        ) = 1,
        '50% 50%',
        coalesce(pp.created_by, p.created_by),
        coalesce(pp.created_at, now())
      from public.person_photos pp
      join public.people p on p.id = pp.person_id
      where pp.photo_path is not null
        and coalesce(pp.created_by, p.created_by) is not null
        and not exists (
          select 1 from public.record_photos rp where rp.photo_path = pp.photo_path
        )
      on conflict (photo_path) do nothing
    $copy_people$;
  end if;

  if to_regclass('public.vehicle_photos') is not null then
    execute $copy_vehicles$
      insert into public.record_photos
        (entity, entity_id, photo_path, is_cover, crop_position, created_by, created_at)
      select
        'vehicles',
        vp.vehicle_id,
        vp.photo_path,
        row_number() over (
          partition by vp.vehicle_id
          order by (vp.photo_path = v.photo_path) desc, vp.sort_order, vp.created_at, vp.id
        ) = 1,
        '50% 50%',
        coalesce(vp.created_by, v.created_by),
        coalesce(vp.created_at, now())
      from public.vehicle_photos vp
      join public.vehicles v on v.id = vp.vehicle_id
      where vp.photo_path is not null
        and coalesce(vp.created_by, v.created_by) is not null
        and not exists (
          select 1 from public.record_photos rp where rp.photo_path = vp.photo_path
        )
      on conflict (photo_path) do nothing
    $copy_vehicles$;
  end if;
end
$migration$;
