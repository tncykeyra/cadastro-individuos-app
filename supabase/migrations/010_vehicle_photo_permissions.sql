-- Match vehicle identity and photo permissions with the individual records.
-- Operators may edit vehicle details and add photos; only admins may change plates,
-- choose/adjust covers, or delete photo rows and files.

-- Permit an authenticated administrator to reassign authorship before deleting an account.
-- Operators still cannot change authorship, names, CPF, or vehicle plates.
create or replace function public.stamp_record_metadata()
returns trigger
language plpgsql
set search_path = ''
as $
begin
  if new.archived_at is distinct from old.archived_at and not public.is_admin() then
    raise exception 'Apenas administrador pode arquivar ou restaurar registros';
  end if;
  if tg_table_name = 'people'
     and (to_jsonb(new)->>'full_name') is distinct from (to_jsonb(old)->>'full_name')
     and not public.is_admin() then
    raise exception 'Apenas administrador pode alterar o nome do indivíduo';
  end if;
  if new.created_by is distinct from old.created_by and not public.is_admin() then
    raise exception 'Apenas administradores podem alterar a autoria do cadastro';
  end if;
  new.id := old.id;
  if not public.is_admin() then new.created_by := old.created_by; end if;
  new.created_at := old.created_at;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$;

create or replace function public.prevent_operator_vehicle_plate_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (select public.is_admin()) and new.plate is distinct from old.plate then
    raise exception 'Apenas administradores podem alterar a placa do veículo';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_plate_admin_only on public.vehicles;
create trigger vehicles_plate_admin_only
  before update on public.vehicles
  for each row execute function public.prevent_operator_vehicle_plate_changes();

-- Apply admin-only photo-row update/deletion to the unified gallery, if installed.
do $$
begin
  if to_regclass('public.record_photos') is not null then
    execute 'alter table public.record_photos enable row level security';
    execute 'grant select, insert, update, delete on public.record_photos to authenticated';
    execute 'drop policy if exists record_photos_staff_read on public.record_photos';
    execute 'create policy record_photos_staff_read on public.record_photos for select to authenticated using ((select public.can_use_app()))';
    execute 'drop policy if exists record_photos_staff_insert on public.record_photos';
    execute 'create policy record_photos_staff_insert on public.record_photos for insert to authenticated with check ((select public.can_use_app()))';
    execute 'drop policy if exists record_photos_admin_update on public.record_photos';
    execute 'create policy record_photos_admin_update on public.record_photos for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))';
    execute 'drop policy if exists record_photos_admin_update_guard on public.record_photos';
    execute 'create policy record_photos_admin_update_guard on public.record_photos as restrictive for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))';
    execute 'drop policy if exists record_photos_admin_delete on public.record_photos';
    execute 'create policy record_photos_admin_delete on public.record_photos for delete to authenticated using ((select public.is_admin()))';
    execute 'drop policy if exists record_photos_admin_delete_guard on public.record_photos';
    execute 'create policy record_photos_admin_delete_guard on public.record_photos as restrictive for delete to authenticated using ((select public.is_admin()))';
  end if;
end;
$$;

-- Older imports may still use person_photos / vehicle_photos instead of record_photos.
-- Restrictive guards keep any older broad policy from granting operators deletion or edits.
do $$
declare
  photo_table text;
begin
  foreach photo_table in array array['person_photos', 'vehicle_photos'] loop
    if to_regclass('public.' || photo_table) is not null then
      execute format('alter table public.%I enable row level security', photo_table);
      execute format('grant select, insert, update, delete on public.%I to authenticated', photo_table);

      execute format('drop policy if exists %I on public.%I', photo_table || '_staff_read', photo_table);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.can_use_app()))', photo_table || '_staff_read', photo_table);
      execute format('drop policy if exists %I on public.%I', photo_table || '_staff_insert', photo_table);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.can_use_app()))', photo_table || '_staff_insert', photo_table);
      execute format('drop policy if exists %I on public.%I', photo_table || '_admin_update', photo_table);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', photo_table || '_admin_update', photo_table);
      execute format('drop policy if exists %I on public.%I', photo_table || '_admin_update_guard', photo_table);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', photo_table || '_admin_update_guard', photo_table);
      execute format('drop policy if exists %I on public.%I', photo_table || '_admin_delete', photo_table);
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_admin()))', photo_table || '_admin_delete', photo_table);
      execute format('drop policy if exists %I on public.%I', photo_table || '_admin_delete_guard', photo_table);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated using ((select public.is_admin()))', photo_table || '_admin_delete_guard', photo_table);
    end if;
  end loop;
end;
$$;

-- The photo bucket is shared by individuals and vehicles.
grant delete on storage.objects to authenticated;
drop policy if exists people_photos_delete_admin on storage.objects;
create policy people_photos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'people-photos' and (select public.is_admin()));
drop policy if exists people_photos_delete_admin_guard on storage.objects;
create policy people_photos_delete_admin_guard on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id = 'people-photos' and (select public.is_admin()));
