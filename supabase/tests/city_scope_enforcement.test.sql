begin;
select plan(14);

select has_policy('public','people','city_scope_guard','individuals are restricted to the active city');
select has_policy('public','vehicles','city_scope_guard','vehicles are restricted to the active city');
select has_policy('public','person_vehicle_links','city_scope_guard','associations are restricted to the active city');
select has_policy('public','person_photos','city_scope_guard','individual photos are restricted to the active city');
select has_policy('public','vehicle_photos','city_scope_guard','vehicle photos are restricted to the active city');
select has_policy('public','record_photos','city_scope_guard','record photos are restricted to the active city');
select has_policy('public','arrest_warrants','city_scope_guard','warrants are restricted to the active city');
select has_policy('public','arrest_warrant_documents','city_scope_guard','warrant PDFs are restricted to the active city');
select has_policy('public','arrest_warrant_matches','city_scope_guard','warrant matches are restricted to the active city');
select has_policy('public','record_revisions','city_scope_guard','revision history is restricted to the active city');
select has_policy('public','audit_events','city_scope_guard','audit events are restricted to the active city');

select ok(
  (select not permissive from pg_policies
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
     and pg_get_serial_sequence('public.people','id') is not null
     and d.adnum=(select attnum from pg_attribute where attrelid=c.oid and attname='city_id')),
  'new individual records default to the authenticated active city'
);

select * from finish();
rollback;
