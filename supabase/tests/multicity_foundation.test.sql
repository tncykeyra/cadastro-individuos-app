begin;
select plan(10);

select has_table('public', 'cities', 'cities table exists');
select has_table('public', 'city_memberships', 'city memberships table exists');
select has_column('public', 'profiles', 'active_city_id', 'profiles store active city');
select has_column('public', 'people', 'city_id', 'people are city scoped');
select has_column('public', 'vehicles', 'city_id', 'vehicles are city scoped');
select has_column('public', 'arrest_warrants', 'city_id', 'warrants are city scoped');
select is((select count(*)::integer from public.cities), 3, 'initial cities are present');
select ok(exists(select 1 from public.cities where slug='lencois-paulista'), 'Lençóis Paulista exists');
select ok(exists(select 1 from public.cities where slug='candido-mota'), 'Cândido Mota exists');
select ok(exists(select 1 from public.cities where slug='agudos'), 'Agudos exists');

select * from finish();
rollback;
