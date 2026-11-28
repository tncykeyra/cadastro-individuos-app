-- Vínculos pessoa a pessoa registrados manualmente. Não classifica identidade nem participação em grupo.
create table public.person_relationships (
  id uuid primary key default gen_random_uuid(),
  person_a_id uuid not null references public.people(id) on delete restrict,
  person_b_id uuid not null references public.people(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('possible_group','known_association','family','other')),
  notes text not null default '',
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  city_id uuid not null default public.current_city_id() references public.cities(id) on delete restrict,
  constraint person_relationships_distinct_people check (person_a_id <> person_b_id)
);

create unique index person_relationships_active_pair_type_uidx
  on public.person_relationships (
    city_id,
    least(person_a_id, person_b_id),
    greatest(person_a_id, person_b_id),
    relationship_type
  )
  where active;

create index person_relationships_person_a_active_idx
  on public.person_relationships (city_id, person_a_id, created_at desc)
  where active;

create index person_relationships_person_b_active_idx
  on public.person_relationships (city_id, person_b_id, created_at desc)
  where active;

alter table public.person_relationships enable row level security;
grant select, insert, update, delete on public.person_relationships to authenticated;

create policy person_relationships_select_city
  on public.person_relationships for select to authenticated
  using (public.can_use_app() and public.can_access_city(city_id));

create policy person_relationships_insert_city
  on public.person_relationships for insert to authenticated
  with check (
    public.can_use_app()
    and public.can_access_city(city_id)
    and created_by = (select auth.uid())
  );

create policy person_relationships_update_author_or_admin
  on public.person_relationships for update to authenticated
  using (
    public.can_use_app()
    and public.can_access_city(city_id)
    and (created_by = (select auth.uid()) or public.is_admin())
  )
  with check (
    public.can_use_app()
    and public.can_access_city(city_id)
    and (created_by = (select auth.uid()) or public.is_admin())
  );

create policy person_relationships_delete_admin
  on public.person_relationships for delete to authenticated
  using (
    public.can_use_app()
    and public.can_access_city(city_id)
    and public.is_admin()
  );

create or replace function public.validate_person_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  city_a uuid;
  city_b uuid;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.person_a_id is distinct from old.person_a_id
       or new.person_b_id is distinct from old.person_b_id
       or new.relationship_type is distinct from old.relationship_type
       or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.city_id is distinct from old.city_id then
      raise exception 'Os dados do vínculo são imutáveis; somente a desativação é permitida.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select p.city_id into city_a
    from public.people p
    where p.id = new.person_a_id and p.archived_at is null;
  select p.city_id into city_b
    from public.people p
    where p.id = new.person_b_id and p.archived_at is null;

  if city_a is null or city_b is null then
    raise exception 'Os dois indivíduos precisam ser cadastros ativos.'
      using errcode = '23503';
  end if;
  if city_a <> city_b then
    raise exception 'Só é possível associar indivíduos da mesma cidade.'
      using errcode = '23514';
  end if;
  if not public.can_access_city(city_a) then
    raise exception 'Sem acesso à cidade dos cadastros relacionados.'
      using errcode = '42501';
  end if;

  new.city_id := city_a;
  new.created_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.validate_person_relationship() from public, anon, authenticated;
create trigger validate_person_relationship_before_write
  before insert or update on public.person_relationships
  for each row execute function public.validate_person_relationship();
