alter table public.people add column if not exists additional_addresses text[] not null default '{}'::text[];
