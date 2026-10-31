-- Allow the authenticated SECURITY DEFINER review RPC to lock and update submissions.
-- RLS still limits changes to administrators with access to the submission's city.
grant update on table public.arrest_warrant_duplicate_submissions to authenticated;

drop policy if exists arrest_warrant_duplicate_admin_update on public.arrest_warrant_duplicate_submissions;
create policy arrest_warrant_duplicate_admin_update
  on public.arrest_warrant_duplicate_submissions
  as permissive
  for update
  to authenticated
  using (public.is_admin() is true)
  with check (public.is_admin() is true);
