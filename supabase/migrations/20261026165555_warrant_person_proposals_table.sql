
create table if not exists public.arrest_warrant_person_proposals (
  id uuid primary key default gen_random_uuid(),
  warrant_id uuid not null references public.arrest_warrants(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 2 and 180),
  cpf_digits text check (cpf_digits is null or cpf_digits ~ '^[0-9]{11}$'),
  rg text not null default '',
  birth_date date,
  address_primary text not null default '',
  filiation text not null default '',
  process_information text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  resulting_person_id uuid references public.people(id) on delete set null,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arrest_warrant_person_proposals_pending_idx
  on public.arrest_warrant_person_proposals (created_at desc)
  where status = 'pending';
create unique index if not exists arrest_warrant_person_proposals_one_pending_per_warrant_idx
  on public.arrest_warrant_person_proposals (warrant_id)
  where status = 'pending';

alter table public.arrest_warrant_person_proposals enable row level security;
drop policy if exists arrest_warrant_person_proposals_admin_read
  on public.arrest_warrant_person_proposals;
create policy arrest_warrant_person_proposals_admin_read
  on public.arrest_warrant_person_proposals
  for select to authenticated
  using (public.is_admin());

revoke all on table public.arrest_warrant_person_proposals from public, anon, authenticated;
grant select on table public.arrest_warrant_person_proposals to authenticated;

