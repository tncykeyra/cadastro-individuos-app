-- Assign the configured role to new profiles when their email is allowlisted.
-- Emails not present in the allowlist remain pending.
alter table public.authorized_emails
  alter column role set default 'operator';

create or replace function public.new_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Promote existing allowlisted profiles that are still pending.
-- Explicitly disabled accounts and existing role assignments remain unchanged.
update public.profiles p
   set role = ae.role,
       updated_at = now()
  from public.authorized_emails ae
 where lower(btrim(p.email)) = lower(btrim(ae.email))
   and p.role = 'pending'
   and ae.role in ('operator', 'admin');
