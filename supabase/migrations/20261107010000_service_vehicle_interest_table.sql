create table if not exists public.service_vehicle_interest (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  created_by uuid not null default auth.uid(),
  city_id uuid not null default public.current_city_id() references public.cities(id) on delete restrict,
  plate_numbers text not null check (char_length(btrim(plate_numbers)) between 1 and 4),
  plate_letters text not null check (char_length(btrim(plate_letters)) between 1 and 3),
  model text not null default '',
  year text not null default '',
  color text not null default '',
  incident_type text not null check (incident_type in ('furto','roubo','outra')),
  plate_city text not null default '',
  occurrence_location text not null default '',
  status text not null default 'active' check (status in ('active','baixado')),
  closed_reason text,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_vehicle_interest_discharge_reason
    check (status <> 'baixado' or nullif(btrim(closed_reason),'') is not null)
);

create index if not exists service_vehicle_interest_status_created_idx
  on public.service_vehicle_interest (status, created_at desc);
create index if not exists service_vehicle_interest_creator_status_idx
  on public.service_vehicle_interest (created_by, status, created_at desc);
create index if not exists service_vehicle_interest_vehicle_idx
  on public.service_vehicle_interest (vehicle_id) where vehicle_id is not null;
create index if not exists service_vehicle_interest_plate_idx
  on public.service_vehicle_interest (plate_numbers, plate_letters);

alter table public.service_vehicle_interest enable row level security;
revoke all on public.service_vehicle_interest from anon;
grant select, insert, update on public.service_vehicle_interest to authenticated;
revoke delete on public.service_vehicle_interest from authenticated;

drop policy if exists service_vehicle_interest_read_scope on public.service_vehicle_interest;
create policy service_vehicle_interest_read_scope
  on public.service_vehicle_interest for select to authenticated
  using (
    public.can_use_app()
    and (
      incident_type in ('furto','roubo')
      or created_by = (select auth.uid())
    )
  );

drop policy if exists service_vehicle_interest_create_scope on public.service_vehicle_interest;
create policy service_vehicle_interest_create_scope
  on public.service_vehicle_interest for insert to authenticated
  with check (
    public.can_use_app()
    and created_by = (select auth.uid())
    and city_id = public.current_city_id()
  );

drop policy if exists service_vehicle_interest_update_scope on public.service_vehicle_interest;
create policy service_vehicle_interest_update_scope
  on public.service_vehicle_interest for update to authenticated
  using (
    public.can_use_app()
    and status = 'active'
    and (
      incident_type in ('furto','roubo')
      or created_by = (select auth.uid())
    )
  )
  with check (
    public.can_use_app()
    and (
      incident_type in ('furto','roubo')
      or created_by = (select auth.uid())
    )
  );

create or replace function public.enforce_service_vehicle_interest_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by
     or new.city_id is distinct from old.city_id then
    raise exception 'Autor e cidade do registro não podem ser alterados.';
  end if;

  if old.status = 'baixado' then
    raise exception 'Um veículo baixado não pode ser alterado.';
  end if;

  if new.status = 'baixado' then
    if nullif(btrim(new.closed_reason),'') is null then
      raise exception 'Informe o motivo da baixa.';
    end if;
    new.closed_at := now();
    new.closed_by := (select auth.uid());
  else
    new.closed_reason := null;
    new.closed_at := null;
    new.closed_by := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists service_vehicle_interest_update_guard on public.service_vehicle_interest;
create trigger service_vehicle_interest_update_guard
  before update on public.service_vehicle_interest
  for each row execute function public.enforce_service_vehicle_interest_update();

comment on table public.service_vehicle_interest is
  'Veículos de interesse do serviço. Furto/roubo são visíveis a usuários autorizados em todas as cidades; outras ocorrências somente ao autor. Baixas são retidas com motivo.';
