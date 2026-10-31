-- Keep audit writes restricted to administrators in the active city.
-- The delete RPCs execute as authenticated and rely on this table privilege plus RLS.
revoke insert on table public.arrest_warrant_events from public, anon;
grant insert on table public.arrest_warrant_events to authenticated;
drop policy if exists arrest_warrant_events_admin_insert on public.arrest_warrant_events;
create policy arrest_warrant_events_admin_insert
  on public.arrest_warrant_events
  as restrictive
  for insert
  to authenticated
  with check (public.is_admin() is true and public.can_access_city(city_id));
