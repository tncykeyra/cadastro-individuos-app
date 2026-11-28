-- Apenas administradores podem escolher capas, alterar metadados de fotos ou apagar fotos.
create or replace function public.assign_first_photo_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    new.is_cover := not exists (
      select 1 from public.record_photos
      where entity = new.entity and entity_id = new.entity_id
    );
  end if;
  return new;
end;
$$;
revoke all on function public.assign_first_photo_cover() from public, anon, authenticated;
drop trigger if exists record_photos_initial_cover on public.record_photos;
create trigger record_photos_initial_cover
  before insert on public.record_photos
  for each row execute function public.assign_first_photo_cover();

drop policy if exists record_photos_staff_update on public.record_photos;
create policy record_photos_admin_update on public.record_photos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists record_photos_staff_delete on public.record_photos;
create policy record_photos_admin_delete on public.record_photos
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists people_photos_update_staff on storage.objects;
create policy people_photos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id='people-photos' and (select public.is_admin()))
  with check (bucket_id='people-photos' and (select public.is_admin()));

drop policy if exists people_photos_delete_staff on storage.objects;
create policy people_photos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id='people-photos' and (select public.is_admin()));

