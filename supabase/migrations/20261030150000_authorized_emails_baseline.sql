-- This table exists in the hosted project but was absent from the original
-- migration history. Keep a fresh local/test database aligned with production.
create table if not exists public.authorized_emails (
  email text primary key
    constraint authorized_emails_normalized check (email = lower(btrim(email))),
  role public.app_role not null default 'operator'
    constraint authorized_emails_allowed_role check (role in ('operator', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.authorized_emails enable row level security;
alter table public.authorized_emails alter column role set default 'operator';

do $policy$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'authorized_emails'
       and policyname = 'authorized_emails_read_admin'
  ) then
    create policy authorized_emails_read_admin
      on public.authorized_emails
      for select
      to authenticated
      using ((select public.is_admin()));
  end if;
end;
$policy$;

revoke all on table public.authorized_emails from anon, authenticated;
grant select on table public.authorized_emails to authenticated;
grant all on table public.authorized_emails to service_role;

create or replace function public.new_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  authorized_role public.app_role;
begin
  select case
           when ae.role in ('operator', 'admin') then ae.role
           else 'pending'::public.app_role
         end
    into authorized_role
    from public.authorized_emails ae
   where lower(btrim(ae.email)) = lower(btrim(coalesce(new.email, '')))
   limit 1;

  insert into public.profiles(id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(authorized_role, 'pending'::public.app_role)
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

update public.profiles p
   set role = ae.role,
       updated_at = now()
  from public.authorized_emails ae
 where lower(btrim(p.email)) = lower(btrim(ae.email))
   and p.role = 'pending'
   and ae.role in ('operator', 'admin');
