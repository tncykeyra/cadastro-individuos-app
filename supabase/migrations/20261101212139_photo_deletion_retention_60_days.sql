create schema if not exists extensions;

create schema if not exists private;

create extension if not exists pg_cron with schema pg_catalog;

create extension if not exists pg_net with schema extensions;

create table if not exists private.photo_retention_queue (
  queue_id bigint generated always as identity primary key,
  bucket_id text not null check (bucket_id = 'people-photos'),
  object_path text not null,
  removed_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '60 days'),
  status text not null default 'queued' check (status in ('queued','processing','deleted','cancelled')),
  attempt_count integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  unique(bucket_id, object_path)
);

create index if not exists photo_retention_queue_due_idx on private.photo_retention_queue (purge_after, queue_id) where status = 'queued';

revoke all on schema private from public, anon, authenticated;

revoke all on private.photo_retention_queue from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.photo_path_is_referenced(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.record_photos rp where rp.photo_path = p_path
    union all
    select 1 from public.people p where p.photo_path = p_path or p_path = any(coalesce(p.photo_paths, array[]::text[]))
    union all
    select 1 from public.vehicles v where v.photo_path = p_path or p_path = any(coalesce(v.photo_paths, array[]::text[]))
    union all
    select 1 from public.person_photos pp where pp.photo_path = p_path
    union all
    select 1 from public.vehicle_photos vp where vp.photo_path = p_path
  );
$function$;


revoke all on function private.photo_path_is_referenced(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_photo_retention_token(p_token text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(p_token <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'photo_retention_cron_token' and decrypted_secret = p_token
  ), false);
$function$


revoke all on function public.check_photo_retention_token(text) from public, anon, authenticated;

grant execute on function public.check_photo_retention_token(text) to service_role;

CREATE OR REPLACE FUNCTION public.claim_due_photo_retention(p_limit integer DEFAULT 100)
 RETURNS TABLE(queue_id bigint, bucket_id text, object_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update private.photo_retention_queue q
     set status = 'queued', claimed_at = null
   where q.status = 'processing' and q.claimed_at < now() - interval '1 hour';

  update private.photo_retention_queue q
     set status = 'cancelled', completed_at = now(), claimed_at = null,
         last_error = 'File is still referenced by a record'
   where q.status = 'queued' and q.purge_after <= now()
     and private.photo_path_is_referenced(q.object_path);

  return query
    with due as (
      select q.queue_id
      from private.photo_retention_queue q
      where q.status = 'queued' and q.purge_after <= now()
      order by q.purge_after, q.queue_id
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 100), 100))
    )
    update private.photo_retention_queue q
       set status = 'processing', claimed_at = now(), attempt_count = q.attempt_count + 1
      from due
     where q.queue_id = due.queue_id
    returning q.queue_id, q.bucket_id, q.object_path;
end;
$function$


revoke all on function public.claim_due_photo_retention(integer) from public, anon, authenticated;

grant execute on function public.claim_due_photo_retention(integer) to service_role;

CREATE OR REPLACE FUNCTION public.finish_photo_retention(p_queue_ids bigint[], p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  update private.photo_retention_queue q
     set status = case when p_success then 'deleted' else 'queued' end,
         completed_at = case when p_success then now() else null end,
         claimed_at = null,
         last_error = case when p_success then null else left(coalesce(p_error, 'Storage removal failed'), 240) end
   where q.queue_id = any(coalesce(p_queue_ids, array[]::bigint[]))
     and q.status = 'processing';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$


revoke all on function public.finish_photo_retention(bigint[], boolean, text) from public, anon, authenticated;

grant execute on function public.finish_photo_retention(bigint[], boolean, text) to service_role;

CREATE OR REPLACE FUNCTION public.delete_record_photos(p_entity text, p_entity_id uuid, p_photo_paths text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_city_id uuid;
  v_current_path text;
  v_cover_path text;
  v_path text;
  v_paths text[];
begin
  if (select auth.uid()) is null or not public.can_use_app() then
    raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
  if p_entity not in ('people', 'vehicles') then
    raise exception 'Tipo de cadastro inválido.' using errcode='22023';
  end if;
  v_paths := array(select distinct x from unnest(coalesce(p_photo_paths, array[]::text[])) x where x is not null and btrim(x) <> '');
  if coalesce(array_length(v_paths, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma foto.' using errcode='22023';
  end if;

  if p_entity = 'people' then
    select city_id, photo_path into v_city_id, v_current_path
      from public.people where id = p_entity_id for update;
  else
    select city_id, photo_path into v_city_id, v_current_path
      from public.vehicles where id = p_entity_id for update;
  end if;
  if not found then raise exception 'Cadastro não encontrado.' using errcode='P0002'; end if;
  if not public.can_access_city(v_city_id) then
    raise exception 'Você não tem acesso à cidade deste cadastro.' using errcode='42501';
  end if;

  foreach v_path in array v_paths loop
    if v_path is distinct from v_current_path and not exists (
      select 1 from public.record_photos rp
      where rp.entity = p_entity and rp.entity_id = p_entity_id and rp.photo_path = v_path
    ) and not (
      (p_entity = 'people' and exists(select 1 from public.person_photos pp where pp.person_id = p_entity_id and pp.photo_path = v_path))
      or
      (p_entity = 'vehicles' and exists(select 1 from public.vehicle_photos vp where vp.vehicle_id = p_entity_id and vp.photo_path = v_path))
    ) then
      raise exception 'Uma das fotos selecionadas não pertence a este cadastro.' using errcode='22023';
    end if;
  end loop;

  delete from public.record_photos
    where entity = p_entity and entity_id = p_entity_id and photo_path = any(v_paths);
  if p_entity = 'people' then
    delete from public.person_photos where person_id = p_entity_id and photo_path = any(v_paths);
  else
    delete from public.vehicle_photos where vehicle_id = p_entity_id and photo_path = any(v_paths);
  end if;

  select rp.photo_path into v_cover_path
    from public.record_photos rp
    where rp.entity = p_entity and rp.entity_id = p_entity_id
      and not (rp.photo_path = any(v_paths))
    order by rp.is_cover desc, rp.created_at asc
    limit 1;

  if v_cover_path is null and p_entity = 'people' then
    select pp.photo_path into v_cover_path from public.person_photos pp
      where pp.person_id = p_entity_id and not (pp.photo_path = any(v_paths))
      order by pp.created_at asc limit 1;
  elsif v_cover_path is null then
    select vp.photo_path into v_cover_path from public.vehicle_photos vp
      where vp.vehicle_id = p_entity_id and not (vp.photo_path = any(v_paths))
      order by vp.created_at asc limit 1;
  end if;
  if v_cover_path is null and not (v_current_path = any(v_paths)) then
    v_cover_path := v_current_path;
  end if;

  update public.record_photos
    set is_cover = (photo_path = v_cover_path)
    where entity = p_entity and entity_id = p_entity_id;

  if p_entity = 'people' then
    update public.people
       set photo_path = v_cover_path,
           photo_paths = array(select item from unnest(coalesce(photo_paths, array[]::text[])) item where not (item = any(v_paths)))
     where id = p_entity_id;
  else
    update public.vehicles
       set photo_path = v_cover_path,
           photo_paths = array(select item from unnest(coalesce(photo_paths, array[]::text[])) item where not (item = any(v_paths)))
     where id = p_entity_id;
  end if;

  foreach v_path in array v_paths loop
    if v_path !~* '^https?://' and not private.photo_path_is_referenced(v_path) then
      insert into private.photo_retention_queue(bucket_id, object_path, removed_at, purge_after, status, attempt_count, last_error, claimed_at, completed_at)
      values ('people-photos', v_path, now(), now() + interval '60 days', 'queued', 0, null, null, null)
      on conflict(bucket_id, object_path) do update
        set removed_at = excluded.removed_at,
            purge_after = excluded.purge_after,
            status = 'queued',
            attempt_count = 0,
            last_error = null,
            claimed_at = null,
            completed_at = null;
    end if;
  end loop;

  return v_paths;
end;
$function$


do $setup$
declare
  v_token text;
begin
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  if not exists(select 1 from vault.secrets where name = 'photo_retention_cron_token') then
    perform vault.create_secret(v_token, 'photo_retention_cron_token', 'Private token for scheduled photo retention cleanup');
  end if;
  if not exists(select 1 from vault.secrets where name = 'photo_retention_project_url') then
    perform vault.create_secret('https://etvxrzjtnhuefxeirkxf.supabase.co', 'photo_retention_project_url');
  end if;
  if not exists(select 1 from vault.secrets where name = 'photo_retention_publishable_key') then
    perform vault.create_secret('sb_publishable_oJKi4SrZKtSvr1kSkm-kog_9XvC2UGz', 'photo_retention_publishable_key');
  end if;
end;
$setup$;

select cron.schedule(
  'purge-retired-photos-daily',
  '0 5 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'photo_retention_project_url') || '/functions/v1/purge-retired-photos',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'photo_retention_publishable_key'),
        'x-retention-token', (select decrypted_secret from vault.decrypted_secrets where name = 'photo_retention_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);
