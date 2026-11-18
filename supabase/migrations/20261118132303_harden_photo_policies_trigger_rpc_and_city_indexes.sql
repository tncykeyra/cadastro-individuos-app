-- Consolidate overlapping policies without changing the active city/admin rules.
drop policy if exists person_photos_staff_insert on public.person_photos;
drop policy if exists person_photos_staff_read on public.person_photos;
drop policy if exists person_photos_update_staff on public.person_photos;

drop policy if exists vehicle_photos_staff_insert on public.vehicle_photos;
drop policy if exists vehicle_photos_staff_read on public.vehicle_photos;
drop policy if exists vehicle_photos_update_staff on public.vehicle_photos;

drop policy if exists record_photos_staff_select on public.record_photos;

-- These functions are only called by PostgreSQL triggers; they are not app RPCs.
revoke all on function public.audit_arrest_warrant() from public, anon, authenticated;
revoke all on function public.audit_arrest_warrant_match() from public, anon, authenticated;
revoke all on function public.capture_revision() from public, anon, authenticated;
revoke all on function public.enforce_city_row_scope() from public, anon, authenticated;
revoke all on function public.guard_google_authorized_signup() from public, anon, authenticated;
revoke all on function public.guard_profile_city_update() from public, anon, authenticated;
revoke all on function public.log_photo_gallery_change() from public, anon, authenticated;
revoke all on function public.log_record_change() from public, anon, authenticated;
revoke all on function public.new_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.queue_warrant_pdf_for_drive() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Support the app's larger city-scoped history/photo queries and warrant lookups.
create index if not exists audit_events_city_id_idx on public.audit_events (city_id);
create index if not exists record_revisions_city_id_idx on public.record_revisions (city_id);
create index if not exists record_photos_city_id_idx on public.record_photos (city_id);
create index if not exists arrest_warrant_documents_warrant_id_idx on public.arrest_warrant_documents (warrant_id);
