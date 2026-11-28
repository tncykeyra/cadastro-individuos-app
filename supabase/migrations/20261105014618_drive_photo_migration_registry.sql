-- Private registry used to keep reversible source-to-Drive photo mappings.
-- Original Storage files are retained; this table contains only metadata.
begin;
create table if not exists public.drive_photo_migrations (
  source_path text primary key,
  drive_file_id text not null,
  entity text not null check (entity in ('people','vehicles')),
  entity_id uuid not null,
  city_id uuid,
  sha256 text not null,
  byte_size bigint not null check (byte_size > 0),
  status text not null default 'active' check (status in ('active','rolled_back')),
  migrated_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  created_by uuid not null references auth.users(id)
);
create unique index if not exists drive_photo_migrations_drive_file_id_key on public.drive_photo_migrations(drive_file_id);
alter table public.drive_photo_migrations enable row level security;
revoke all on public.drive_photo_migrations from public, anon, authenticated;
grant all on public.drive_photo_migrations to service_role;
commit;

