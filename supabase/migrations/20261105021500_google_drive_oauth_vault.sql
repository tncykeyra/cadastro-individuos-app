-- Private OAuth state and Google Drive credentials for reversible photo migration.
-- No existing record or Storage object is modified by this migration.
begin;

create table if not exists public.drive_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.drive_oauth_states enable row level security;
revoke all on public.drive_oauth_states from public, anon, authenticated;
grant all on public.drive_oauth_states to service_role;

create table if not exists public.drive_storage_config (
  id boolean primary key default true check (id),
  folder_id text not null,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.drive_storage_config enable row level security;
revoke all on public.drive_storage_config from public, anon, authenticated;
grant all on public.drive_storage_config to service_role;

create or replace function public.drive_store_credentials(p_refresh_token text, p_folder_id text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden'; end if;
  if p_refresh_token is null or length(p_refresh_token) < 20 or p_folder_id is null or length(p_folder_id) < 10 then
    raise exception 'invalid credentials';
  end if;
  if not exists (select 1 from public.city_memberships m where m.user_id=p_actor and m.is_master) then
    raise exception 'master administrator required';
  end if;
  select s.id into v_secret_id from vault.secrets s where s.name='cadastro-drive-refresh-token' limit 1;
  if v_secret_id is null then
    perform vault.create_secret(p_refresh_token, 'cadastro-drive-refresh-token', 'OAuth refresh token for private Cadastro Criminal photo storage');
  else
    perform vault.update_secret(v_secret_id, p_refresh_token, 'cadastro-drive-refresh-token', 'OAuth refresh token for private Cadastro Criminal photo storage');
  end if;
  insert into public.drive_storage_config(id,folder_id,connected_by,connected_at,updated_at)
    values (true,p_folder_id,p_actor,now(),now())
    on conflict (id) do update set folder_id=excluded.folder_id,connected_by=excluded.connected_by,connected_at=now(),updated_at=now();
end;
$$;

create or replace function public.drive_get_refresh_token()
returns text language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret from vault.decrypted_secrets d where d.name='cadastro-drive-refresh-token' limit 1
$$;

revoke all on function public.drive_store_credentials(text,text,uuid) from public, anon, authenticated;
revoke all on function public.drive_get_refresh_token() from public, anon, authenticated;
grant execute on function public.drive_store_credentials(text,text,uuid) to service_role;
grant execute on function public.drive_get_refresh_token() to service_role;

commit;

