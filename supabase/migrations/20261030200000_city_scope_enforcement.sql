-- Enforce one active city for each authenticated operator/admin.
-- Additive, transactional, and does not alter existing record values or files.
begin;

-- Backfill any profile that has not yet received its city in the foundation migration.
update public.profiles
set active_city_id='10000000-0000-4000-8000-000000000001'
where active_city_id is null;

-- New rows follow the signed-in user's selected city, never a hard-coded municipality.
do $$
declare t text;
begin
  foreach t in array array[
    'people','vehicles','person_vehicle_links','person_photos','vehicle_photos','record_photos',
    'arrest_warrants','arrest_warrant_import_batches','arrest_warrant_documents','arrest_warrant_matches',
    'arrest_warrant_duplicate_submissions','arrest_warrant_events','arrest_warrant_person_proposals',
    'person_identity_change_proposals','vehicle_plate_change_proposals','duplicate_record_reviews',
    'record_revisions','audit_events'
  ] loop
    execute format('alter table public.%I alter column city_id set default public.current_city_id()',t);
  end loop;
end $$;

-- City admins manage only their active city; only the master manages global access.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce((select auth.jwt()->'app_metadata'->>'provider')='google',false)
    and public.can_use_app()
    and public.can_manage_city(public.current_city_id())
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce((select auth.jwt()->'app_metadata'->>'provider')='google',false)
    and public.is_master_admin()
$$;

-- Application access requires an assigned city. A Google-authenticated account
-- without an assignment remains pending and cannot query city records.
create or replace function public.can_use_app()
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce((select auth.jwt()->'app_metadata'->>'provider')='google',false)
    and exists(
      select 1 from public.profiles p
      where p.id=(select auth.uid()) and p.role in ('operator','admin')
        and p.active_city_id is not null
    )
    and (
      public.is_master_admin()
      or exists(
        select 1 from public.city_memberships m
        where m.user_id=(select auth.uid())
          and m.city_id=public.current_city_id()
          and m.role in ('operator','admin')
      )
    )
$$;

-- Restrictive policies AND with existing permission policies, preserving each
-- table's current operator/admin actions while forcing every row into one city.
do $$
declare t text;
begin
  foreach t in array array[
    'people','vehicles','person_vehicle_links','person_photos','vehicle_photos','record_photos',
    'arrest_warrants','arrest_warrant_import_batches','arrest_warrant_documents','arrest_warrant_matches',
    'arrest_warrant_duplicate_submissions','arrest_warrant_events','arrest_warrant_person_proposals',
    'person_identity_change_proposals','vehicle_plate_change_proposals','duplicate_record_reviews',
    'record_revisions','audit_events'
  ] loop
    execute format('drop policy if exists city_scope_guard on public.%I',t);
    execute format(
      'create policy city_scope_guard on public.%I as restrictive for all to authenticated using (public.can_access_city(city_id)) with check (public.can_access_city(city_id))',
      t
    );
  end loop;
end $$;

-- Defense in depth for SECURITY DEFINER RPCs: their owner is changed below to
-- authenticated, and this trigger also rejects cross-city or cross-city links.
create or replace function public.enforce_city_row_scope()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_city uuid;
begin
  if (select auth.uid()) is null then
    return case when tg_op='DELETE' then old else new end;
  end if;
  v_city:=case when tg_op='DELETE' then old.city_id else new.city_id end;
  if not public.can_access_city(v_city) then
    raise exception 'A conta só pode consultar e alterar registros da cidade atribuída.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and not public.can_access_city(old.city_id) then
    raise exception 'O registro pertence a outra cidade.' using errcode='42501';
  end if;

  if tg_op<>'DELETE' then
    if tg_table_name='person_vehicle_links' and exists(
      select 1 from public.people p join public.vehicles v on v.id=new.vehicle_id
      where p.id=new.person_id and (p.city_id<>new.city_id or v.city_id<>new.city_id)
    ) then raise exception 'Não é permitido associar cadastros de cidades diferentes.' using errcode='23514'; end if;
    if tg_table_name='person_photos' and not exists(
      select 1 from public.people p where p.id=new.person_id and p.city_id=new.city_id
    ) then raise exception 'A fotografia deve pertencer a um indivíduo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='vehicle_photos' and not exists(
      select 1 from public.vehicles v where v.id=new.vehicle_id and v.city_id=new.city_id
    ) then raise exception 'A fotografia deve pertencer a um veículo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='record_photos' and (
      (new.entity='people' and not exists(select 1 from public.people p where p.id=new.entity_id and p.city_id=new.city_id))
      or (new.entity='vehicles' and not exists(select 1 from public.vehicles v where v.id=new.entity_id and v.city_id=new.city_id))
    ) then raise exception 'A fotografia deve pertencer a um cadastro da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_documents' and not exists(
      select 1 from public.arrest_warrants w where w.id=new.warrant_id and w.city_id=new.city_id
    ) then raise exception 'O PDF deve pertencer a um mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_matches' and (
      not exists(select 1 from public.arrest_warrants w where w.id=new.warrant_id and w.city_id=new.city_id)
      or (new.person_id is not null and not exists(select 1 from public.people p where p.id=new.person_id and p.city_id=new.city_id))
    ) then raise exception 'A correspondência deve ligar registros da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_person_proposals' and not exists(
      select 1 from public.arrest_warrants w where w.id=new.warrant_id and w.city_id=new.city_id
    ) then raise exception 'A proposta deve pertencer a um mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_duplicate_submissions' and new.matched_warrant_id is not null and not exists(
      select 1 from public.arrest_warrants w where w.id=new.matched_warrant_id and w.city_id=new.city_id
    ) then raise exception 'A revisão de duplicidade deve pertencer à mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='arrest_warrant_events' and new.warrant_id is not null and not exists(
      select 1 from public.arrest_warrants w where w.id=new.warrant_id and w.city_id=new.city_id
    ) then raise exception 'O histórico deve pertencer ao mandado da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='person_identity_change_proposals' and not exists(
      select 1 from public.people p where p.id=new.person_id and p.city_id=new.city_id
    ) then raise exception 'A sugestão deve pertencer a um indivíduo da mesma cidade.' using errcode='23514'; end if;
    if tg_table_name='vehicle_plate_change_proposals' and not exists(
      select 1 from public.vehicles v where v.id=new.vehicle_id and v.city_id=new.city_id
    ) then raise exception 'A sugestão deve pertencer a um veículo da mesma cidade.' using errcode='23514'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'people','vehicles','person_vehicle_links','person_photos','vehicle_photos','record_photos',
    'arrest_warrants','arrest_warrant_import_batches','arrest_warrant_documents','arrest_warrant_matches',
    'arrest_warrant_duplicate_submissions','arrest_warrant_events','arrest_warrant_person_proposals',
    'person_identity_change_proposals','vehicle_plate_change_proposals','duplicate_record_reviews',
    'record_revisions','audit_events'
  ] loop
    execute format('drop trigger if exists enforce_city_scope on public.%I',t);
    execute format('create trigger enforce_city_scope before insert or update or delete on public.%I for each row execute function public.enforce_city_row_scope()',t);
  end loop;
end $$;

-- City administrators may see the profiles assigned to their current city;
-- they cannot inspect or change another city's users. Global e-mail access stays master-only.
drop policy if exists profiles_city_scope_guard on public.profiles;
create policy profiles_city_scope_guard on public.profiles as restrictive for select to authenticated
using (
  id=(select auth.uid()) or public.is_master_admin()
  or (public.can_manage_city(public.current_city_id()) and exists(
    select 1 from public.city_memberships m
    where m.user_id=profiles.id and m.city_id=public.current_city_id()
  ))
);
drop policy if exists profiles_update_scope_guard on public.profiles;
create policy profiles_update_scope_guard on public.profiles as restrictive for update to authenticated
using (id=(select auth.uid()) or public.is_master_admin())
with check (id=(select auth.uid()) or public.is_master_admin());
drop policy if exists authorized_emails_master_guard on public.authorized_emails;
create policy authorized_emails_master_guard on public.authorized_emails as restrictive for all to authenticated
using (public.is_master_admin()) with check (public.is_master_admin());

-- Storage remains private and preserves existing role policies. The restrictive
-- checks bind private photos/PDFs to a record in the active city.
create or replace function public.can_access_city_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path=''
as $$
  select case
    when p_bucket='people-photos' then
      exists(select 1 from public.people p where p.photo_path=p_name and public.can_access_city(p.city_id))
      or exists(select 1 from public.vehicles v where v.photo_path=p_name and public.can_access_city(v.city_id))
      or exists(select 1 from public.person_photos p where p.photo_path=p_name and public.can_access_city(p.city_id))
      or exists(select 1 from public.vehicle_photos v where v.photo_path=p_name and public.can_access_city(v.city_id))
      or exists(select 1 from public.record_photos r where r.photo_path=p_name and public.can_access_city(r.city_id))
      or exists(select 1 from public.people p where split_part(p_name,'/',1)='people'
        and split_part(p_name,'/',2)=p.id::text and public.can_access_city(p.city_id))
      or exists(select 1 from public.vehicles v where split_part(p_name,'/',1)='vehicles'
        and split_part(p_name,'/',2)=v.id::text and public.can_access_city(v.city_id))
    when p_bucket='warrant-documents' then
      exists(select 1 from public.arrest_warrant_documents d
        where d.storage_path=p_name and public.can_access_city(d.city_id))
    when p_bucket='fiscalization-guides' then public.can_use_app()
    else false
  end
$$;

drop policy if exists city_scope_private_files_select on storage.objects;
create policy city_scope_private_files_select on storage.objects as restrictive for select to authenticated
using (
  (bucket_id not in ('people-photos','warrant-documents','fiscalization-guides'))
  or public.can_access_city_storage_object(bucket_id,name)
);
drop policy if exists city_scope_private_files_insert on storage.objects;
create policy city_scope_private_files_insert on storage.objects as restrictive for insert to authenticated
with check (
  (bucket_id not in ('people-photos','warrant-documents','fiscalization-guides'))
  or (bucket_id='people-photos' and public.can_access_city_storage_object(bucket_id,name))
  or (bucket_id='warrant-documents'
      and public.can_manage_city(public.current_city_id())
      and split_part(name,'/',1)=(select auth.uid())::text)
  or (bucket_id='fiscalization-guides' and public.is_master_admin())
);
drop policy if exists city_scope_private_files_update on storage.objects;
create policy city_scope_private_files_update on storage.objects as restrictive for update to authenticated
using (
  bucket_id not in ('people-photos','warrant-documents','fiscalization-guides')
  or public.can_access_city_storage_object(bucket_id,name)
)
with check (
  bucket_id not in ('people-photos','warrant-documents','fiscalization-guides')
  or public.can_access_city_storage_object(bucket_id,name)
);
drop policy if exists city_scope_private_files_delete on storage.objects;
create policy city_scope_private_files_delete on storage.objects as restrictive for delete to authenticated
using (
  bucket_id not in ('people-photos','warrant-documents','fiscalization-guides')
  or public.can_access_city_storage_object(bucket_id,name)
);

revoke all on function public.can_access_city_storage_object(text,text) from public,anon;
grant execute on function public.can_access_city_storage_object(text,text) to authenticated;

-- Privileged application RPCs must run with the caller's city RLS context.
-- Leave only global account-management and auth bootstrap functions as postgres-owned.
grant create on schema public to authenticated;
do $$
declare r record;
begin
  for r in
    select p.proname,pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and p.prorettype<>'trigger'::regtype and p.prorettype<>'event_trigger'::regtype
      and p.proname not in ('admin_manage_authorized_email','admin_set_user_role','is_email_authorized')
  loop
    execute format('alter function public.%I(%s) owner to authenticated',r.proname,r.args);
  end loop;
end $$;
revoke create on schema public from authenticated;

commit;
