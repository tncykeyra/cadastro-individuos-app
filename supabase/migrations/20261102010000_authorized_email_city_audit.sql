create table if not exists public.authorized_email_city_audit (
  email text not null,
  city_id uuid not null references public.cities(id) on delete cascade,
  role text not null check (role in ('operator', 'admin')),
  created_by uuid,
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (email, city_id)
);

alter table public.authorized_email_city_audit enable row level security;
revoke all on table public.authorized_email_city_audit from public, anon, authenticated;
grant select, insert, update on table public.authorized_email_city_audit to service_role;

insert into public.authorized_email_city_audit (
  email, city_id, role, created_by, created_by_email, created_by_name,
  created_at, updated_by, updated_by_email, updated_by_name, updated_at
)
select
  lower(p.email),
  cm.city_id,
  cm.role,
  cm.created_by,
  creator.email,
  creator.display_name,
  cm.created_at,
  cm.created_by,
  creator.email,
  creator.display_name,
  cm.created_at
from public.city_memberships cm
join public.profiles p on p.id = cm.user_id
left join public.profiles creator on creator.id = cm.created_by
where cm.role in ('operator', 'admin')
  and cm.is_master is false
on conflict (email, city_id) do nothing;
