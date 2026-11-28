-- The authenticated SECURITY DEFINER delete RPC needs these table privileges.
-- RLS below restricts every write to admins in the active city.
grant select on table public.arrest_warrant_matches to authenticated;
grant delete on table public.arrest_warrant_matches, public.arrest_warrant_person_proposals, public.arrest_warrants to authenticated;
grant update on table public.arrest_warrant_events to authenticated;

create policy arrest_warrant_matches_admin_delete
  on public.arrest_warrant_matches
  as permissive
  for delete
  to authenticated
  using (public.is_admin() is true);

create policy arrest_warrant_person_proposals_admin_delete
  on public.arrest_warrant_person_proposals
  as permissive
  for delete
  to authenticated
  using (public.is_admin() is true);

create policy arrest_warrants_admin_delete
  on public.arrest_warrants
  as permissive
  for delete
  to authenticated
  using (public.is_admin() is true);

create policy arrest_warrant_events_admin_update
  on public.arrest_warrant_events
  as permissive
  for update
  to authenticated
  using (public.is_admin() is true)
  with check (public.is_admin() is true);
