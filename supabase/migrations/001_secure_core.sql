-- Cadastro protegido: rode uma vez no Supabase SQL Editor.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

do $$ begin create type public.app_role as enum ('pending','operator','admin','disabled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.vehicle_relation as enum ('owner','driver','associated'); exception when duplicate_object then null; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role public.app_role not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  cpf_digits text,
  rg text not null default '',
  registration text not null default '',
  alias text not null default '',
  birthday date,
  address_primary text not null default '',
  address_secondary text not null default '',
  notes text not null default '',
  occurrence_notes text not null default '',
  occurrence_reference text not null default '',
  photo_path text,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cpf_digits is null or (cpf_digits ~ '^[0-9]{11}$'))
);
create unique index people_cpf_active_uq on public.people(cpf_digits) where cpf_digits is not null and archived_at is null;
create index people_name_trgm_idx on public.people using gin (full_name extensions.gin_trgm_ops);
create index people_address_primary_trgm_idx on public.people using gin (address_primary extensions.gin_trgm_ops);
create index people_address_secondary_trgm_idx on public.people using gin (address_secondary extensions.gin_trgm_ops);
create index people_alias_trgm_idx on public.people using gin (alias extensions.gin_trgm_ops);
create index people_rg_trgm_idx on public.people using gin (rg extensions.gin_trgm_ops);
create index people_registration_trgm_idx on public.people using gin (registration extensions.gin_trgm_ops);
create index people_cpf_trgm_idx on public.people using gin (cpf_digits extensions.gin_trgm_ops);
create index people_notes_trgm_idx on public.people using gin (notes extensions.gin_trgm_ops);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  make text not null default '',
  model text not null default '',
  color text not null default '',
  notes text not null default '',
  photo_path text,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vehicles_plate_active_uq on public.vehicles(plate) where archived_at is null;
create index vehicles_plate_trgm_idx on public.vehicles using gin (plate extensions.gin_trgm_ops);
create index vehicles_model_trgm_idx on public.vehicles using gin (model extensions.gin_trgm_ops);
create index vehicles_make_trgm_idx on public.vehicles using gin (make extensions.gin_trgm_ops);
create index vehicles_color_trgm_idx on public.vehicles using gin (color extensions.gin_trgm_ops);
create index vehicles_notes_trgm_idx on public.vehicles using gin (notes extensions.gin_trgm_ops);

create table public.person_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  person_id uuid not null references public.people(id),
  vehicle_id uuid not null references public.vehicles(id),
  relation public.vehicle_relation not null default 'associated',
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index person_vehicle_active_uq on public.person_vehicle_links(person_id,vehicle_id,relation) where active=true;
create index person_vehicle_person_idx on public.person_vehicle_links(person_id);
create index person_vehicle_vehicle_idx on public.person_vehicle_links(vehicle_id);

create or replace function public.stamp_record_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.archived_at is distinct from old.archived_at and not public.is_admin() then
    raise exception 'Apenas administrador pode arquivar ou restaurar registros';
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
create trigger stamp_people before update on public.people for each row execute function public.stamp_record_metadata();
create trigger stamp_vehicles before update on public.vehicles for each row execute function public.stamp_record_metadata();

-- Logs identify the actor, action and record, but do not duplicate personal data.
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now()
);

-- Revision snapshots are sensitive and visible only to administrators.
create table public.record_revisions (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null check (entity in ('people','vehicles','person_vehicle_links')),
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
$$;
create or replace function public.can_use_app()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('operator','admin'))
$$;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_use_app() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_use_app() to authenticated;

create or replace function public.new_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,display_name,role)
  values(new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'name',''), 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.new_profile_for_auth_user();

create or replace function public.admin_set_user_role(target_user_id uuid, target_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  admins_count integer;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem alterar privilégios';
  end if;
  if target_role not in ('operator','admin','disabled') then
    raise exception 'Perfil de destino inválido';
  end if;
  if target_role <> 'admin' and exists(select 1 from public.profiles where id=target_user_id and role='admin') then
    select count(*) into admins_count from public.profiles where role='admin';
    if admins_count <= 1 then raise exception 'O sistema precisa manter pelo menos um administrador'; end if;
  end if;
  update public.profiles set role=target_role, updated_at=now() where id=target_user_id;
  if not found then raise exception 'Usuário não encontrado'; end if;
  insert into public.audit_events(actor_id,action,entity,entity_id)
  values((select auth.uid()), 'role_changed:'||target_role::text, 'profile', target_user_id);
end;
$$;
revoke all on function public.admin_set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;

create or replace function public.log_record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare record_id uuid;
begin
  if tg_op='DELETE' then record_id := old.id; else record_id := new.id; end if;
  insert into public.audit_events(actor_id,action,entity,entity_id)
  values((select auth.uid()), lower(tg_op), tg_table_name, record_id);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger audit_people after insert or update or delete on public.people for each row execute function public.log_record_change();
create trigger audit_vehicles after insert or update or delete on public.vehicles for each row execute function public.log_record_change();
create trigger audit_person_vehicle_links after insert or update or delete on public.person_vehicle_links for each row execute function public.log_record_change();

create or replace function public.capture_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare record_id uuid; old_row jsonb; new_row jsonb;
begin
  if tg_op='DELETE' then record_id:=old.id; old_row:=to_jsonb(old); new_row:=null;
  elsif tg_op='INSERT' then record_id:=new.id; old_row:=null; new_row:=to_jsonb(new);
  else record_id:=new.id; old_row:=to_jsonb(old); new_row:=to_jsonb(new); end if;
  insert into public.record_revisions(actor_id,action,entity,entity_id,before_data,after_data)
  values((select auth.uid()),lower(tg_op),tg_table_name,record_id,old_row,new_row);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger revision_people after insert or update or delete on public.people for each row execute function public.capture_revision();
create trigger revision_vehicles after insert or update or delete on public.vehicles for each row execute function public.capture_revision();
create trigger revision_links after insert or update or delete on public.person_vehicle_links for each row execute function public.capture_revision();

create or replace function public.admin_revert_revision(revision_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.record_revisions%rowtype;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Apenas administradores podem restaurar versões'; end if;
  select * into r from public.record_revisions where id=revision_id;
  if not found then raise exception 'Versão não encontrada'; end if;
  if r.entity='people' then
    if r.before_data is null then
      update public.people set archived_at=coalesce(archived_at,now()),updated_by=(select auth.uid()) where id=r.entity_id;
    else
      update public.people set full_name=r.before_data->>'full_name',cpf_digits=nullif(r.before_data->>'cpf_digits',''),rg=coalesce(r.before_data->>'rg',''),registration=coalesce(r.before_data->>'registration',''),alias=coalesce(r.before_data->>'alias',''),birthday=nullif(r.before_data->>'birthday','')::date,address_primary=coalesce(r.before_data->>'address_primary',''),address_secondary=coalesce(r.before_data->>'address_secondary',''),notes=coalesce(r.before_data->>'notes',''),occurrence_notes=coalesce(r.before_data->>'occurrence_notes',''),occurrence_reference=coalesce(r.before_data->>'occurrence_reference',''),photo_path=r.before_data->>'photo_path',archived_at=nullif(r.before_data->>'archived_at','')::timestamptz,updated_by=(select auth.uid()) where id=r.entity_id;
    end if;
  elsif r.entity='vehicles' then
    if r.before_data is null then
      update public.vehicles set archived_at=coalesce(archived_at,now()),updated_by=(select auth.uid()) where id=r.entity_id;
    else
      update public.vehicles set plate=r.before_data->>'plate',make=coalesce(r.before_data->>'make',''),model=coalesce(r.before_data->>'model',''),color=coalesce(r.before_data->>'color',''),notes=coalesce(r.before_data->>'notes',''),photo_path=r.before_data->>'photo_path',archived_at=nullif(r.before_data->>'archived_at','')::timestamptz,updated_by=(select auth.uid()) where id=r.entity_id;
    end if;
  elsif r.entity='person_vehicle_links' then
    if r.before_data is null then
      update public.person_vehicle_links set active=false where id=r.entity_id;
    else
      update public.person_vehicle_links set person_id=(r.before_data->>'person_id')::uuid,vehicle_id=(r.before_data->>'vehicle_id')::uuid,relation=(r.before_data->>'relation')::public.vehicle_relation,notes=coalesce(r.before_data->>'notes',''),active=coalesce((r.before_data->>'active')::boolean,true) where id=r.entity_id;
    end if;
  end if;
  insert into public.audit_events(actor_id,action,entity,entity_id) values((select auth.uid()),'revision_reverted:'||revision_id::text,r.entity,r.entity_id);
end;
$$;
revoke all on function public.admin_revert_revision(bigint) from public,anon;
grant execute on function public.admin_revert_revision(bigint) to authenticated;

create or replace function public.search_people(search_term text, result_limit integer default 100)
returns setof public.people language sql stable security invoker set search_path = '' as $$
  with q as (select extensions.unaccent(lower(trim(coalesce(search_term,'')))) as term)
  select p.* from public.people p, q
  where p.archived_at is null and length(q.term)>=2 and (
    extensions.unaccent(lower(p.full_name)) like '%'||q.term||'%' or (regexp_replace(q.term,'[^0-9]','','g') <> '' and lower(coalesce(p.cpf_digits,'')) like '%'||regexp_replace(q.term,'[^0-9]','','g')||'%')
    or extensions.unaccent(lower(p.rg)) like '%'||q.term||'%' or extensions.unaccent(lower(p.registration)) like '%'||q.term||'%'
    or extensions.unaccent(lower(p.alias)) like '%'||q.term||'%' or extensions.unaccent(lower(p.address_primary)) like '%'||q.term||'%'
    or extensions.unaccent(lower(p.address_secondary)) like '%'||q.term||'%' or extensions.unaccent(lower(p.notes)) like '%'||q.term||'%'
    or extensions.unaccent(lower(p.occurrence_notes)) like '%'||q.term||'%' or extensions.unaccent(lower(p.occurrence_reference)) like '%'||q.term||'%'
  )
  order by p.full_name limit least(greatest(coalesce(result_limit,100),1),100)
$$;
create or replace function public.search_vehicles(search_term text, result_limit integer default 100)
returns setof public.vehicles language sql stable security invoker set search_path = '' as $$
  with q as (select lower(trim(coalesce(search_term,''))) as term)
  select distinct v.* from public.vehicles v cross join q
  left join public.person_vehicle_links l on l.vehicle_id=v.id and l.active=true
  left join public.people p on p.id=l.person_id and p.archived_at is null
  where v.archived_at is null and length(q.term)>=2 and (
    extensions.unaccent(lower(v.plate)) like '%'||q.term||'%' or extensions.unaccent(lower(v.make)) like '%'||q.term||'%'
    or extensions.unaccent(lower(v.model)) like '%'||q.term||'%' or extensions.unaccent(lower(v.color)) like '%'||q.term||'%'
    or extensions.unaccent(lower(v.notes)) like '%'||q.term||'%' or extensions.unaccent(lower(coalesce(p.full_name,''))) like '%'||q.term||'%'
    or (regexp_replace(q.term,'[^0-9]','','g') <> '' and lower(coalesce(p.cpf_digits,'')) like '%'||regexp_replace(q.term,'[^0-9]','','g')||'%')
    or extensions.unaccent(lower(coalesce(p.alias,''))) like '%'||q.term||'%' or extensions.unaccent(lower(coalesce(p.address_primary,''))) like '%'||q.term||'%'
    or extensions.unaccent(lower(coalesce(p.address_secondary,''))) like '%'||q.term||'%'
  )
  order by v.plate limit least(greatest(coalesce(result_limit,100),1),100)
$$;
revoke all on function public.search_people(text,integer), public.search_vehicles(text,integer) from public, anon;
grant execute on function public.search_people(text,integer), public.search_vehicles(text,integer) to authenticated;

alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.vehicles enable row level security;
alter table public.person_vehicle_links enable row level security;
alter table public.audit_events enable row level security;
alter table public.record_revisions enable row level security;

revoke all on public.profiles, public.people, public.vehicles, public.person_vehicle_links, public.audit_events, public.record_revisions from anon, public;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,insert,update on public.people, public.vehicles to authenticated;
grant select,insert,update on public.person_vehicle_links to authenticated;
grant select on public.audit_events, public.record_revisions to authenticated;

create policy profiles_read_self_or_admin on public.profiles for select to authenticated using (id=(select auth.uid()) or (select public.is_admin()));
create policy profiles_update_self_or_admin on public.profiles for update to authenticated using (id=(select auth.uid()) or (select public.is_admin())) with check (id=(select auth.uid()) or (select public.is_admin()));
create policy people_read_staff on public.people for select to authenticated using ((select public.can_use_app()));
create policy people_insert_staff on public.people for insert to authenticated with check ((select public.can_use_app()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()) and archived_at is null);
create policy people_update_staff on public.people for update to authenticated using ((select public.can_use_app())) with check ((select public.can_use_app()) and updated_by=(select auth.uid()));
create policy vehicles_read_staff on public.vehicles for select to authenticated using ((select public.can_use_app()));
create policy vehicles_insert_staff on public.vehicles for insert to authenticated with check ((select public.can_use_app()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
create policy vehicles_update_staff on public.vehicles for update to authenticated using ((select public.can_use_app())) with check ((select public.can_use_app()) and updated_by=(select auth.uid()));
create policy links_read_staff on public.person_vehicle_links for select to authenticated using ((select public.can_use_app()));
create policy links_insert_staff on public.person_vehicle_links for insert to authenticated with check ((select public.can_use_app()) and created_by=(select auth.uid()));
create policy links_update_staff on public.person_vehicle_links for update to authenticated using ((select public.can_use_app())) with check ((select public.can_use_app()));
create policy audit_read_admin on public.audit_events for select to authenticated using ((select public.is_admin()));
create policy revisions_read_admin on public.record_revisions for select to authenticated using ((select public.is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('people-photos','people-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy people_photos_read_staff on storage.objects for select to authenticated using (bucket_id='people-photos' and (select public.can_use_app()));
create policy people_photos_insert_staff on storage.objects for insert to authenticated with check (bucket_id='people-photos' and (select public.can_use_app()));
create policy people_photos_update_staff on storage.objects for update to authenticated using (bucket_id='people-photos' and (select public.can_use_app())) with check (bucket_id='people-photos' and (select public.can_use_app()));
create policy people_photos_delete_staff on storage.objects for delete to authenticated using (bucket_id='people-photos' and (select public.can_use_app()));
