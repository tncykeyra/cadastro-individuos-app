-- Keep the existing restrictive city guard and add a matching permissive admin rule.
-- PostgreSQL requires a permissive policy in addition to restrictive policies for INSERT.
create policy arrest_warrant_events_admin_insert_allowed
  on public.arrest_warrant_events
  as permissive
  for insert
  to authenticated
  with check (public.is_admin() is true and public.can_access_city(city_id));
