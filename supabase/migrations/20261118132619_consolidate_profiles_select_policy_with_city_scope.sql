-- Preserve self access, all-city master access, and limit local admins to
-- memberships in their active city while removing overlapping SELECT policies.
drop policy if exists profiles_master_read_all on public.profiles;
drop policy if exists profiles_read_self_or_admin on public.profiles;

create policy profiles_read_self_admin_master
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_master_admin())
  or (
    (select public.is_admin())
    and exists (
      select 1
      from public.city_memberships m
      where m.user_id = profiles.id
        and m.city_id = (select public.current_city_id())
    )
  )
);
