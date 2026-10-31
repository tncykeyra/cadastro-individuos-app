begin;
select plan(19);

select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='people' and policyname='city_scope_guard'),
  'individuals are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='vehicles' and policyname='city_scope_guard'),
  'vehicles are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='person_vehicle_links' and policyname='city_scope_guard'),
  'associations are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='person_photos' and policyname='city_scope_guard'),
  'individual photos are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='vehicle_photos' and policyname='city_scope_guard'),
  'vehicle photos are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='record_photos' and policyname='city_scope_guard'),
  'record photos are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='arrest_warrants' and policyname='city_scope_guard'),
  'warrants are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='arrest_warrant_documents' and policyname='city_scope_guard'),
  'warrant PDFs are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='arrest_warrant_matches' and policyname='city_scope_guard'),
  'warrant matches are restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='record_revisions' and policyname='city_scope_guard'),
  'revision history is restricted to the active city'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='audit_events' and policyname='city_scope_guard'),
  'audit events are restricted to the active city'
);

select ok(
  (select permissive='RESTRICTIVE' from pg_policies
   where schemaname='public' and tablename='people' and policyname='city_scope_guard'),
  'city boundary policy is restrictive and cannot be bypassed by another permissive policy'
);
select ok(
  (select pg_get_userbyid(proowner)='authenticated'
   from pg_proc where oid='public.admin_delete_arrest_warrant(uuid)'::regprocedure),
  'administrative record RPC runs with authenticated RLS context'
);
select ok(
  (select pg_get_expr(d.adbin,d.adrelid) like '%current_city_id%'
   from pg_attrdef d join pg_class c on c.oid=d.adrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='people'
     and d.adnum=(select attnum from pg_attribute where attrelid=c.oid and attname='city_id')),
  'new individual records default to the authenticated active city'
);

select ok(
  not has_table_privilege('authenticated','public.city_memberships','INSERT'),
  'operators cannot create city assignments directly'
);
select ok(
  pg_get_functiondef('public.guard_profile_city_update()'::regprocedure)
    like '%m.city_id=new.active_city_id%' and pg_get_functiondef('public.guard_profile_city_update()'::regprocedure) like '%c.active%',
  'profile city changes require an active membership'
);
select ok(
  pg_get_functiondef('public.master_assign_user_cities(uuid,uuid[],text)'::regprocedure)
    like '%ON CONFLICT (user_id, city_id)%'
    and pg_get_functiondef('public.master_assign_user_cities(uuid,uuid[],text)'::regprocedure) not like '%DELETE FROM public.city_memberships%',
  'master city assignment adds memberships without removing previous cities'
);

select ok(
  not exists(select 1 from pg_indexes where schemaname='public' and indexname='city_memberships_one_city_per_user'),
  'database permits multiple city memberships per user'
);
select ok(
  pg_get_functiondef('public.set_active_city(uuid)'::regprocedure)
    like '%m.city_id=p_city_id%' and pg_get_functiondef('public.set_active_city(uuid)'::regprocedure) like '%m.user_id=(select auth.uid())%',
  'users can switch only to a city assigned to their account'
);

select * from finish();
rollback;
