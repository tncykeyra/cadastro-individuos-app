create table if not exists public.email_first_access_codes (
  email text primary key,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.email_first_access_codes enable row level security;
revoke all on table public.email_first_access_codes from public, anon, authenticated;
grant all on table public.email_first_access_codes to service_role;
