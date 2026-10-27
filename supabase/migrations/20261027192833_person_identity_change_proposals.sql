-- Operator-submitted changes to an existing person's name/CPF require admin review.
create table public.person_identity_change_proposals (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  current_full_name text not null,
  current_cpf_digits text,
  proposed_full_name text not null,
  proposed_cpf_digits text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint person_identity_current_cpf_format
    check (current_cpf_digits is null or current_cpf_digits ~ '^[0-9]{11}$'),
  constraint person_identity_proposed_cpf_format
    check (proposed_cpf_digits is null or proposed_cpf_digits ~ '^[0-9]{11}$'),
  constraint person_identity_proposed_name_nonempty
    check (length(btrim(proposed_full_name)) between 2 and 180)
);

create unique index person_identity_one_pending_per_person
  on public.person_identity_change_proposals(person_id)
  where status = 'pending';
create index person_identity_proposals_status_created
  on public.person_identity_change_proposals(status, created_at);

alter table public.person_identity_change_proposals enable row level security;
revoke all on table public.person_identity_change_proposals from public, anon, authenticated;
grant select on table public.person_identity_change_proposals to authenticated;
create policy person_identity_proposals_read_own_or_admin
  on public.person_identity_change_proposals
  for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));

create or replace function public.submit_person_identity_change_proposal(
  p_person_id uuid,
  p_full_name text,
  p_cpf_digits text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people%rowtype;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf_digits, ''), '[^0-9]', '', 'g'), '');
  v_existing public.person_identity_change_proposals%rowtype;
  v_proposal_id uuid;
begin
  if (select auth.uid()) is null or not public.can_use_app() then
    raise exception 'A sessão não está autorizada para enviar sugestões.';
  end if;
  if public.is_admin() then
    raise exception 'Administradores podem editar nome e CPF diretamente.';
  end if;
  if length(v_name) < 2 or length(v_name) > 180 then
    raise exception 'O nome deve ter entre 2 e 180 caracteres.';
  end if;
  if v_cpf is not null and length(v_cpf) <> 11 then
    raise exception 'O CPF deve conter exatamente 11 números.';
  end if;

  select * into v_person
  from public.people
  where id = p_person_id and archived_at is null
  for update;
  if not found then
    raise exception 'Indivíduo não encontrado ou indisponível.';
  end if;
  if v_person.full_name is not distinct from v_name
     and v_person.cpf_digits is not distinct from v_cpf then
    raise exception 'Nome e CPF não tiveram alterações para sugerir.';
  end if;
  if v_cpf is not null and exists (
    select 1 from public.people p
    where p.archived_at is null and p.cpf_digits = v_cpf and p.id <> p_person_id
  ) then
    raise exception 'Este CPF já pertence a outro indivíduo.';
  end if;

  select * into v_existing
  from public.person_identity_change_proposals
  where person_id = p_person_id and status = 'pending'
  for update;

  if found then
    if v_existing.requested_by is distinct from (select auth.uid()) then
      raise exception 'Já existe uma sugestão pendente para este cadastro. Aguarde a revisão do administrador.';
    end if;
    update public.person_identity_change_proposals
    set current_full_name = v_person.full_name,
        current_cpf_digits = v_person.cpf_digits,
        proposed_full_name = v_name,
        proposed_cpf_digits = v_cpf,
        created_at = now()
    where id = v_existing.id
    returning id into v_proposal_id;
    return v_proposal_id;
  end if;

  insert into public.person_identity_change_proposals (
    person_id, current_full_name, current_cpf_digits,
    proposed_full_name, proposed_cpf_digits, requested_by
  ) values (
    p_person_id, v_person.full_name, v_person.cpf_digits,
    v_name, v_cpf, (select auth.uid())
  ) returning id into v_proposal_id;

  return v_proposal_id;
end;
$$;

create or replace function public.admin_review_person_identity_change_proposal(
  p_proposal_id uuid,
  p_approve boolean,
  p_review_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.person_identity_change_proposals%rowtype;
  v_person public.people%rowtype;
  v_note text := left(btrim(coalesce(p_review_note, '')), 500);
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem revisar estas sugestões.';
  end if;
  if p_approve is null then
    raise exception 'Escolha aprovar ou rejeitar a sugestão.';
  end if;

  select * into v_proposal
  from public.person_identity_change_proposals
  where id = p_proposal_id and status = 'pending'
  for update;
  if not found then
    raise exception 'A sugestão já foi revisada ou não existe.';
  end if;

  select * into v_person
  from public.people
  where id = v_proposal.person_id and archived_at is null
  for update;
  if not found then
    raise exception 'O cadastro relacionado não está mais disponível.';
  end if;

  if p_approve then
    if v_proposal.proposed_cpf_digits is not null and exists (
      select 1 from public.people p
      where p.archived_at is null
        and p.cpf_digits = v_proposal.proposed_cpf_digits
        and p.id <> v_person.id
    ) then
      raise exception 'Este CPF já pertence a outro indivíduo. A sugestão não foi aplicada.';
    end if;

    if v_person.full_name is distinct from v_proposal.proposed_full_name
       or v_person.cpf_digits is distinct from v_proposal.proposed_cpf_digits then
      update public.people
      set full_name = v_proposal.proposed_full_name,
          cpf_digits = v_proposal.proposed_cpf_digits,
          updated_by = (select auth.uid())
      where id = v_person.id;
    end if;

    update public.person_identity_change_proposals
    set status = 'approved',
        reviewed_by = (select auth.uid()),
        reviewed_at = now(),
        review_note = v_note
    where id = v_proposal.id;
  else
    update public.person_identity_change_proposals
    set status = 'rejected',
        reviewed_by = (select auth.uid()),
        reviewed_at = now(),
        review_note = coalesce(nullif(v_note, ''), 'Rejeitada pelo administrador.')
    where id = v_proposal.id;
  end if;
end;
$$;

revoke all on function public.submit_person_identity_change_proposal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_person_identity_change_proposal(uuid, text, text) to authenticated;
revoke all on function public.admin_review_person_identity_change_proposal(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_review_person_identity_change_proposal(uuid, boolean, text) to authenticated;
