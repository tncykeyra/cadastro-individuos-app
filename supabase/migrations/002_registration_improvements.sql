-- Cadastro: CPF globalmente único, galeria privada e ações administrativas.
do $$
begin
  if exists (
    select 1 from public.people
    where cpf_digits is not null
    group by cpf_digits having count(*) > 1
  ) then
    raise exception 'Há CPFs duplicados em public.people. Resolva as duplicidades antes de aplicar esta migração.';
  end if;
end;
$$;

drop index if exists public.people_cpf_active_uq;
create unique index people_cpf_unique_uq on public.people(cpf_digits) where cpf_digits is not null;

create table public.record_photos (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('people','vehicles')),
  entity_id uuid not null,
  photo_path text not null unique,
  is_cover boolean not null default false,
  crop_position text not null default '50% 50%',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index record_photos_entity_idx on public.record_photos(entity,entity_id,created_at);
create unique index record_photos_one_cover_uq on public.record_photos(entity,entity_id) where is_cover;

alter table public.record_photos enable row level security;
revoke all on public.record_photos from anon,public;
grant select,insert,update,delete on public.record_photos to authenticated;
create policy record_photos_staff_select on public.record_photos for select to authenticated using ((select public.can_use_app()));
create policy record_photos_staff_insert on public.record_photos for insert to authenticated with check ((select public.can_use_app()) and created_by=(select auth.uid()));
create policy record_photos_staff_update on public.record_photos for update to authenticated using ((select public.can_use_app())) with check ((select public.can_use_app()));
create policy record_photos_staff_delete on public.record_photos for delete to authenticated using ((select public.can_use_app()));

create or replace function public.admin_clear_revision_history()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem limpar o histórico';
  end if;
  delete from public.record_revisions;
  insert into public.audit_events(actor_id,action,entity)
  values((select auth.uid()),'revision_history_cleared','record_revisions');
end;
$$;
revoke all on function public.admin_clear_revision_history() from public,anon;
grant execute on function public.admin_clear_revision_history() to authenticated;

create or replace function public.admin_delete_record(target_entity text,target_record_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare linked_ids uuid[];
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem excluir cadastros';
  end if;
  if target_entity='people' then
    select coalesce(array_agg(id),'{}'::uuid[]) into linked_ids from public.person_vehicle_links where person_id=target_record_id;
    delete from public.person_vehicle_links where person_id=target_record_id;
    delete from public.people where id=target_record_id;
  elsif target_entity='vehicles' then
    select coalesce(array_agg(id),'{}'::uuid[]) into linked_ids from public.person_vehicle_links where vehicle_id=target_record_id;
    delete from public.person_vehicle_links where vehicle_id=target_record_id;
    delete from public.vehicles where id=target_record_id;
  else
    raise exception 'Tipo de cadastro inválido';
  end if;
  if not found then raise exception 'Cadastro não encontrado'; end if;
  delete from public.record_revisions where entity_id=target_record_id or entity_id=any(linked_ids);
  delete from public.record_photos where entity=target_entity and entity_id=target_record_id;
  insert into public.audit_events(actor_id,action,entity,entity_id)
  values((select auth.uid()),'admin_deleted','record',target_record_id);
end;
$$;
revoke all on function public.admin_delete_record(text,uuid) from public,anon;
grant execute on function public.admin_delete_record(text,uuid) to authenticated;

