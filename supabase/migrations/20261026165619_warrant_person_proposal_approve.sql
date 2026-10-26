create or replace function public.admin_approve_arrest_warrant_person_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.arrest_warrant_person_proposals%rowtype;
  v_person_id uuid;
  v_process_reference text := '';
  v_notes text := '';
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem aprovar propostas.';
  end if;

  select * into v_proposal
  from public.arrest_warrant_person_proposals
  where id = p_proposal_id and status = 'pending'
  for update;

  if not found then
    raise exception 'A proposta já foi revisada ou não existe.';
  end if;

  if v_proposal.cpf_digits is not null and exists (
    select 1 from public.people p
    where p.archived_at is null and p.cpf_digits = v_proposal.cpf_digits
  ) then
    raise exception 'Já existe um indivíduo com esse CPF. Revise e vincule o cadastro existente.';
  end if;

  if regexp_replace(upper(coalesce(v_proposal.rg, '')), '[^A-Z0-9]', '', 'g') <> ''
     and exists (
       select 1 from public.people p
       where p.archived_at is null
         and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g')
             = regexp_replace(upper(v_proposal.rg), '[^A-Z0-9]', '', 'g')
     ) then
    raise exception 'Já existe um indivíduo com esse RG. Revise e vincule o cadastro existente.';
  end if;

  if exists (
    select 1 from public.arrest_warrant_matches m
    where m.warrant_id = v_proposal.warrant_id and m.review_status = 'confirmed'
  ) then
    raise exception 'Esse mandado já foi vinculado. Atualize a página e revise o cadastro.';
  end if;

  select coalesce(w.source_reference, '') into v_process_reference
  from public.arrest_warrants w where w.id = v_proposal.warrant_id;

  if btrim(v_proposal.filiation) <> '' then
    v_notes := 'Filiação:' || E'\n' || btrim(v_proposal.filiation);
  end if;

  insert into public.people (
    full_name, cpf_digits, rg, birthday, address_primary, notes,
    occurrence_notes, occurrence_reference, created_by, updated_by
  ) values (
    v_proposal.full_name, v_proposal.cpf_digits, v_proposal.rg, v_proposal.birth_date,
    v_proposal.address_primary, v_notes, v_proposal.process_information,
    v_process_reference, (select auth.uid()), (select auth.uid())
  )
  returning id into v_person_id;

  insert into public.arrest_warrant_matches (
    warrant_id, person_id, match_basis, confidence, review_status, reviewed_by, reviewed_at
  ) values (
    v_proposal.warrant_id, v_person_id, 'manual_review', 100, 'confirmed',
    (select auth.uid()), now()
  );

  update public.arrest_warrant_person_proposals
  set status = 'approved',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      resulting_person_id = v_person_id,
      updated_at = now()
  where id = v_proposal.id;

  return v_person_id;
end;
$$;

