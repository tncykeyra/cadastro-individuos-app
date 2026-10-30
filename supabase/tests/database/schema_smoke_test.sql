begin;

select plan(3);

select has_table('public', 'profiles', 'profiles table is available');
select has_table('public', 'people', 'people table is available');
select has_table('public', 'vehicles', 'vehicles table is available');

select * from finish();

rollback;
