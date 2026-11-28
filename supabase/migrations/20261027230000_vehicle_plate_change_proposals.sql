create table public.vehicle_plate_change_proposals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  current_plate text not null,
  proposed_plate text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint vehicle_plate_current_format check (current_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  constraint vehicle_plate_proposed_format check (proposed_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  constraint vehicle_plate_proposed_nonempty check (length(btrim(proposed_plate)) = 7)
);
create unique index vehicle_plate_one_pending_per_vehicle on public.vehicle_plate_change_proposals(vehicle_id) where status='pending';
create index vehicle_plate_proposals_status_created on public.vehicle_plate_change_proposals(status,created_at);
alter table public.vehicle_plate_change_proposals enable row level security;
revoke all on public.vehicle_plate_change_proposals from public, anon, authenticated;
grant select on public.vehicle_plate_change_proposals to authenticated;
create policy vehicle_plate_proposals_read_own_or_admin on public.vehicle_plate_change_proposals for select to authenticated using (requested_by=(select auth.uid()) or (select public.is_admin()));

create or replace function public.submit_vehicle_plate_change_proposal(p_vehicle_id uuid,p_plate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_plate text := upper(regexp_replace(coalesce(p_plate,''),'[^A-Za-z0-9]','','g'));
  v_existing public.vehicle_plate_change_proposals%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null or not public.can_use_app() then raise exception 'Sessão não autorizada.'; end if;
  if public.is_admin() then raise exception 'Administradores podem editar a placa diretamente.'; end if;
  if v_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then raise exception 'A placa deve seguir o padrão AAA0000 ou AAA0A00.'; end if;
  select * into v_vehicle from public.vehicles where id=p_vehicle_id and archived_at is null for update;
  if not found then raise exception 'Veículo não encontrado ou indisponível.'; end if;
  if v_vehicle.plate=v_plate then raise exception 'A placa não foi alterada.'; end if;
  if exists(select 1 from public.vehicles v where v.archived_at is null and upper(regexp_replace(v.plate,'[^A-Za-z0-9]','','g'))=v_plate and v.id<>p_vehicle_id) then raise exception 'Esta placa já pertence a outro veículo.'; end if;
  select * into v_existing from public.vehicle_plate_change_proposals where vehicle_id=p_vehicle_id and status='pending' for update;
  if found then
    if v_existing.requested_by is distinct from (select auth.uid()) then raise exception 'Já existe uma sugestão pendente para este veículo.'; end if;
    update public.vehicle_plate_change_proposals set current_plate=v_vehicle.plate,proposed_plate=v_plate,created_at=now() where id=v_existing.id returning id into v_id;
    return v_id;
  end if;
  insert into public.vehicle_plate_change_proposals(vehicle_id,current_plate,proposed_plate,requested_by) values(p_vehicle_id,v_vehicle.plate,v_plate,(select auth.uid())) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_review_vehicle_plate_change_proposal(p_proposal_id uuid,p_approve boolean,p_review_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare
  v_proposal public.vehicle_plate_change_proposals%rowtype;
  v_vehicle public.vehicles%rowtype;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Apenas administradores podem revisar estas sugestões.'; end if;
  select * into v_proposal from public.vehicle_plate_change_proposals where id=p_proposal_id and status='pending' for update;
  if not found then raise exception 'A sugestão já foi revisada ou não existe.'; end if;
  select * into v_vehicle from public.vehicles where id=v_proposal.vehicle_id and archived_at is null for update;
  if not found then raise exception 'O veículo relacionado não está mais disponível.'; end if;
  if v_vehicle.plate is distinct from v_proposal.current_plate then raise exception 'A placa do veículo mudou desde o envio. Atualize o cadastro e revise novamente.'; end if;
  if p_approve and exists(select 1 from public.vehicles v where v.archived_at is null and upper(regexp_replace(v.plate,'[^A-Za-z0-9]','','g'))=v_proposal.proposed_plate and v.id<>v_vehicle.id) then raise exception 'Esta placa já pertence a outro veículo.'; end if;
  if p_approve then update public.vehicles set plate=v_proposal.proposed_plate,updated_by=(select auth.uid()),updated_at=now() where id=v_vehicle.id; end if;
  update public.vehicle_plate_change_proposals set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=(select auth.uid()),review_note=left(btrim(coalesce(p_review_note,'')),500),reviewed_at=now() where id=v_proposal.id;
end $$;
revoke all on function public.submit_vehicle_plate_change_proposal(uuid,text) from public,anon;
revoke all on function public.admin_review_vehicle_plate_change_proposal(uuid,boolean,text) from public,anon;
grant execute on function public.submit_vehicle_plate_change_proposal(uuid,text) to authenticated;
grant execute on function public.admin_review_vehicle_plate_change_proposal(uuid,boolean,text) to authenticated;