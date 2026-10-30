-- Multi-city foundation for the existing Cadastro Criminal database.
-- Additive only: current records are assigned to Lençóis Paulista; nothing is deleted.
begin;

-- This gallery table exists in production but was historically created outside
-- the checked-in migrations. Keep local/test databases aligned without changing
-- the existing production table.
create table if not exists public.person_photos (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  photo_path text not null unique,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.person_photos enable row level security;
grant select,insert,update,delete on public.person_photos to authenticated;
do $
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='person_photos_read_staff') then
    create policy person_photos_read_staff on public.person_photos for select to authenticated using (public.can_use_app());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='person_photos_staff_insert') then
    create policy person_photos_staff_insert on public.person_photos for insert to authenticated with check (public.can_use_app());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='person_photos_update_staff') then
    create policy person_photos_update_staff on public.person_photos for update to authenticated using (public.can_use_app()) with check (public.can_use_app());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='person_photos_admin_delete_guard') then
    create policy person_photos_admin_delete_guard on public.person_photos as restrictive for delete to authenticated using (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='person_photos_admin_update_guard') then
    create policy person_photos_admin_update_guard on public.person_photos as restrictive for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end;
$;

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint cities_name_nonempty check (length(btrim(name)) between 2 and 100),
  constraint cities_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

insert into public.cities (id,name,slug)
values
  ('10000000-0000-4000-8000-000000000001','Lençóis Paulista','lencois-paulista'),
  ('10000000-0000-4000-8000-000000000002','Cândido Mota','candido-mota'),
  ('10000000-0000-4000-8000-000000000003','Agudos','agudos')
on conflict (slug) do update set name=excluded.name;

create table if not exists public.city_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete restrict,
  role text not null default 'operator',
  is_master boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id,city_id),
  constraint city_memberships_role_check check (role in ('operator','admin','master')),
  constraint city_memberships_master_role_check check ((is_master and role='master') or (not is_master and role in ('operator','admin')))
);

alter table public.profiles
  add column if not exists active_city_id uuid references public.cities(id) on delete restrict;

update public.profiles set active_city_id='10000000-0000-4000-8000-000000000001' where active_city_id is null;

-- Current app data is all for Lençóis Paulista. Assign every existing row there.
alter table public.people add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.vehicles add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.person_vehicle_links add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.person_photos add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.vehicle_photos add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.record_photos add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrants add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_import_batches add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_documents add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_matches add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_duplicate_submissions add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_events add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.arrest_warrant_person_proposals add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.person_identity_change_proposals add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.vehicle_plate_change_proposals add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.duplicate_record_reviews add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.record_revisions add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';
alter table public.audit_events add column if not exists city_id uuid default '10000000-0000-4000-8000-000000000001';

-- Derive child record city from its parent so later imports remain correctly grouped.
update public.person_vehicle_links l set city_id=p.city_id
from public.people p where p.id=l.person_id;
update public.person_photos x set city_id=p.city_id from public.people p where p.id=x.person_id;
update public.vehicle_photos x set city_id=v.city_id from public.vehicles v where v.id=x.vehicle_id;
update public.record_photos x set city_id=p.city_id
from public.people p where x.entity='people' and p.id=x.entity_id;
update public.record_photos x set city_id=v.city_id
from public.vehicles v where x.entity='vehicles' and v.id=x.entity_id;
update public.arrest_warrant_documents d set city_id=w.city_id
from public.arrest_warrants w where w.id=d.warrant_id;
update public.arrest_warrant_matches m set city_id=p.city_id
from public.people p where p.id=m.person_id;
update public.arrest_warrant_duplicate_submissions d set city_id=w.city_id
from public.arrest_warrants w where w.id=d.matched_warrant_id;
update public.arrest_warrant_events e set city_id=w.city_id
from public.arrest_warrants w where w.id=e.warrant_id;
update public.arrest_warrant_person_proposals p set city_id=w.city_id
from public.arrest_warrants w where w.id=p.warrant_id;
update public.person_identity_change_proposals s set city_id=p.city_id
from public.people p where p.id=s.person_id;
update public.vehicle_plate_change_proposals s set city_id=v.city_id
from public.vehicles v where v.id=s.vehicle_id;
update public.record_revisions r set city_id=p.city_id
from public.people p where r.entity='people' and p.id=r.entity_id;
update public.record_revisions r set city_id=v.city_id
from public.vehicles v where r.entity='vehicles' and v.id=r.entity_id;
update public.audit_events a set city_id=p.city_id
from public.people p where a.entity='people' and p.id=a.entity_id;
update public.audit_events a set city_id=v.city_id
from public.vehicles v where a.entity='vehicles' and v.id=a.entity_id;

-- Link rows must never span two cities.
do $$
begin
  if exists (
    select 1 from public.person_vehicle_links l
    join public.people p on p.id=l.person_id
    join public.vehicles v on v.id=l.vehicle_id
    where p.city_id <> v.city_id
  ) then
    raise exception 'Existe associação entre pessoa e veículo de cidades diferentes; a migração foi cancelada sem alterar os registros.';
  end if;
end;
$$;

-- Every scoped record must have a city. Defaults preserve compatibility for current clients
-- while the app is upgraded; the final isolation policies are enabled in the follow-up migration.
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
    execute format('update public.%I set city_id=$1 where city_id is null',t)
      using '10000000-0000-4000-8000-000000000001'::uuid;
    execute format('alter table public.%I alter column city_id set default $1',t)
      using '10000000-0000-4000-8000-000000000001'::uuid;
    execute format('alter table public.%I alter column city_id set not null',t);
    execute format('alter table public.%I add constraint %I foreign key (city_id) references public.cities(id) on delete restrict',
      t,t||'_city_id_fkey');
  end loop;
end;
$$;

-- Preserve the current access model by assigning existing authorized accounts to Lençóis.
-- Existing admins are marked master so the current administrator does not lose access.
insert into public.city_memberships(user_id,city_id,role,is_master)
select p.id,'10000000-0000-4000-8000-000000000001',
       case when lower(p.email)='tncykeyra@gmail.com' and p.role='admin' and a.role='admin' then 'master'
            when p.role='admin' and a.role='admin' then 'admin' else 'operator' end,
       (lower(p.email)='tncykeyra@gmail.com' and p.role='admin' and a.role='admin')
from public.profiles p
join public.authorized_emails a on lower(a.email)=lower(p.email)
where p.role in ('operator','admin')
on conflict (user_id,city_id) do nothing;

alter table public.cities enable row level security;
alter table public.city_memberships enable row level security;

create or replace function public.is_master_admin()
returns boolean
language sql stable security definer
set search_path=''
as $$
  select exists (
    select 1 from public.city_memberships m
    where m.user_id=(select auth.uid()) and m.is_master
  )
$$;

create or replace function public.current_city_id()
returns uuid
language sql stable security definer
set search_path=''
as $$
  select p.active_city_id from public.profiles p where p.id=(select auth.uid())
$$;

create or replace function public.can_access_city(p_city_id uuid)
returns boolean
language sql stable security definer
set search_path=''
as $$
  select p_city_id is not null
    and p_city_id=public.current_city_id()
    and (
      public.is_master_admin()
      or exists (
        select 1 from public.city_memberships m
        where m.user_id=(select auth.uid()) and m.city_id=p_city_id
      )
    )
$$;

create or replace function public.can_manage_city(p_city_id uuid)
returns boolean
language sql stable security definer
set search_path=''
as $$
  select p_city_id is not null
    and p_city_id=public.current_city_id()
    and (
      public.is_master_admin()
      or exists (
        select 1 from public.city_memberships m
        where m.user_id=(select auth.uid()) and m.city_id=p_city_id and m.role in ('admin','master')
      )
    )
$$;

create or replace function public.list_my_cities()
returns table(id uuid,name text,slug text,role text,active boolean)
language sql stable security definer
set search_path=''
as $$
  select c.id,c.name,c.slug,m.role,(c.id=public.current_city_id())
  from public.cities c
  join public.city_memberships m on m.city_id=c.id
  where m.user_id=(select auth.uid()) and c.active
  union all
  select c.id,c.name,c.slug,'master',(c.id=public.current_city_id())
  from public.cities c
  where public.is_master_admin() and c.active
    and not exists(select 1 from public.city_memberships m where m.city_id=c.id and m.user_id=(select auth.uid()))
  order by 2
$$;

create or replace function public.set_active_city(p_city_id uuid)
returns void
language plpgsql security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null or not (
    public.is_master_admin()
    or (p_city_id=public.current_city_id() and exists(select 1 from public.city_memberships m where m.user_id=(select auth.uid()) and m.city_id=p_city_id))
  ) then
    raise exception 'Você não tem acesso a esta cidade.' using errcode='42501';
  end if;
  update public.profiles set active_city_id=p_city_id where id=(select auth.uid());
  if not found then raise exception 'Perfil não encontrado.'; end if;
end;
$$;

create or replace function public.master_create_city(p_name text)
returns uuid
language plpgsql security definer
set search_path=''
as $$
declare v_name text:=btrim(coalesce(p_name,'')); v_slug text; v_id uuid;
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode criar cidades.' using errcode='42501';
  end if;
  if length(v_name)<2 or length(v_name)>100 then raise exception 'Informe um nome de cidade válido.' using errcode='22023'; end if;
  v_slug:=trim(both '-' from regexp_replace(lower(extensions.unaccent(v_name)),'[^a-z0-9]+','-','g'));
  if v_slug='' then raise exception 'O nome da cidade não gerou um identificador válido.' using errcode='22023'; end if;
  insert into public.cities(name,slug,created_by) values(v_name,v_slug,(select auth.uid()))
    returning id into v_id;
  insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
    values((select auth.uid()),v_id,'master',true,(select auth.uid()));
  return v_id;
exception when unique_violation then
  raise exception 'Já existe uma cidade com esse nome.' using errcode='23505';
end;
$$;

create or replace function public.master_assign_city_user(p_user_id uuid,p_city_id uuid,p_role text)
returns void
language plpgsql security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode atribuir usuários.' using errcode='42501';
  end if;
  if p_role not in ('operator','admin') then raise exception 'Perfil de cidade inválido.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id and p.role in ('operator','admin')) then
    raise exception 'O usuário ainda não concluiu o primeiro acesso.' using errcode='22023';
  end if;
  if not exists(select 1 from public.cities c where c.id=p_city_id and c.active) then
    raise exception 'Cidade não encontrada ou desativada.' using errcode='22023';
  end if;
  if exists(select 1 from public.city_memberships m where m.user_id=p_user_id and m.is_master) then
    raise exception 'O administrador master não pode ser atribuído como usuário de cidade.' using errcode='42501';
  end if;
  if exists(select 1 from public.city_memberships m where m.user_id=p_user_id and m.city_id<>p_city_id) then
    raise exception 'Este usuário já está vinculado a outra cidade. Remova o vínculo anterior antes de atribuir uma nova cidade.' using errcode='23505';
  end if;
  insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
    values(p_user_id,p_city_id,p_role,false,(select auth.uid()))
  on conflict(user_id,city_id) do update set role=excluded.role,is_master=false,created_by=(select auth.uid()),created_at=now();
  -- First assignment becomes the user's active city. Later assignments do not
  -- silently change their current workspace.
  update public.profiles
     set active_city_id=p_city_id
   where id=p_user_id
     and not public.is_master_admin()
     and not exists (
       select 1 from public.city_memberships m
       where m.user_id=p_user_id and m.city_id=active_city_id
     );
end;
$$;

create or replace function public.remove_city_user(p_user_id uuid,p_city_id uuid)
returns void
language plpgsql security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode remover atribuições.' using errcode='42501';
  end if;
  if exists(select 1 from public.city_memberships where user_id=p_user_id and city_id=p_city_id and is_master) then
    raise exception 'A atribuição de administrador master não pode ser removida por este recurso.' using errcode='42501';
  end if;
  delete from public.city_memberships where user_id=p_user_id and city_id=p_city_id;
end;
$$;

create or replace function public.guard_profile_city_update()
returns trigger
language plpgsql security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null or public.is_master_admin() then return new; end if;
  if new.role is distinct from old.role or lower(new.email) is distinct from lower(old.email) then
    raise exception 'Somente o administrador master pode alterar perfil ou e-mail.' using errcode='42501';
  end if;
  if new.active_city_id is distinct from old.active_city_id then
    raise exception 'Somente o administrador master pode trocar a cidade ativa.' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_city_update on public.profiles;
create trigger profiles_guard_city_update before update on public.profiles
for each row execute function public.guard_profile_city_update();

create policy cities_read_membership on public.cities for select to authenticated
using (
  public.is_master_admin()
  or exists(select 1 from public.city_memberships m where m.user_id=(select auth.uid()) and m.city_id=cities.id)
);
create policy city_memberships_read_scope on public.city_memberships for select to authenticated
using (
  user_id=(select auth.uid())
  or public.is_master_admin()
  or (city_id=public.current_city_id() and public.can_manage_city(city_id))
);

-- Membership and city writes are only available through the guarded master RPCs.
revoke all on public.cities,public.city_memberships from anon,authenticated;
grant select on public.cities,public.city_memberships to authenticated;

revoke all on function public.is_master_admin() from public,anon;
revoke all on function public.current_city_id() from public,anon;
revoke all on function public.can_access_city(uuid) from public,anon;
revoke all on function public.can_manage_city(uuid) from public,anon;
revoke all on function public.list_my_cities() from public,anon;
revoke all on function public.set_active_city(uuid) from public,anon;
revoke all on function public.master_create_city(text) from public,anon;
revoke all on function public.master_assign_city_user(uuid,uuid,text) from public,anon;
revoke all on function public.remove_city_user(uuid,uuid) from public,anon;
grant execute on function public.is_master_admin() to authenticated;
grant execute on function public.current_city_id() to authenticated;
grant execute on function public.can_access_city(uuid) to authenticated;
grant execute on function public.can_manage_city(uuid) to authenticated;
grant execute on function public.list_my_cities() to authenticated;
grant execute on function public.set_active_city(uuid) to authenticated;
grant execute on function public.master_create_city(text) to authenticated;
grant execute on function public.master_assign_city_user(uuid,uuid,text) to authenticated;
grant execute on function public.remove_city_user(uuid,uuid) to authenticated;

create index if not exists people_city_name_active_idx on public.people(city_id,full_name) where archived_at is null;
create index if not exists people_city_cpf_idx on public.people(city_id,cpf_digits) where cpf_digits is not null;
create index if not exists vehicles_city_plate_active_idx on public.vehicles(city_id,plate) where archived_at is null;
create index if not exists arrest_warrants_city_status_idx on public.arrest_warrants(city_id,status);

commit;
