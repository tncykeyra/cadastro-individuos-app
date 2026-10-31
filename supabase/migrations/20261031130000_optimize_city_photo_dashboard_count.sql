-- Keep the dashboard photo count scoped to the active city and avoid a full UNION scan.
-- Each individual is counted once when any supported photo source contains a non-empty path.
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
    select count(*)
    from public.people p
    where p.city_id = v_city_id
      and p.archived_at is null
      and (
        (p.photo_path is not null and btrim(p.photo_path) <> '')
        or exists (
          select 1
          from public.record_photos rp
          where rp.entity = 'people'
            and rp.entity_id = p.id
            and rp.city_id = v_city_id
            and rp.photo_path is not null
            and rp.photo_path <> ''
        )
        or exists (
          select 1
          from public.person_photos pp
          where pp.person_id = p.id
            and pp.city_id = v_city_id
            and pp.photo_path is not null
            and pp.photo_path <> ''
        )
      )
  );
end;
$$;
