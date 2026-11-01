create or replace function public.admin_approve_arrest_warrant_person_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proposal public.arrest_warrant_person_proposals%rowtype;
  v_person_id uuid;
  v_process_reference text := '';
  v_notes text := '';
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado.';
  end if;

  select *
    into v_proposal
  from public.arrest_warrant_person_proposals
  where id = p_proposal_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'A proposta já foi revisada ou não existe.';
  end if;

  if not public.can_manage_city(v_proposal.city_id) then
    raise exception 'Você não tem permissão administrativa para esta cidade.';
  end if;

  select coalesce(w.source_reference, '')
    into v_process_reference
  from public.arrest_warrants w
  where w.id = v_proposal.warrant_id
    and w.city_id = v_proposal.city_id
  for update;

  if not found then
    raise exception 'O mandado não existe na cidade desta proposta.';
  end if;

  if v_proposal.cpf_digits is not null and exists (
    select 1
    from public.people p
    where p.archived_at is null
      and p.city_id = v_proposal.city_id
      and p.cpf_digits = v_proposal.cpf_digits
  ) then
    raise exception 'Já existe um indivíduo com esse CPF nesta cidade. Vincule o cadastro existente.';
  end if;

  if regexp_replace(upper(coalesce(v_proposal.rg, '')), '[^A-Z0-9]', '', 'g') <> ''
     and exists (
       select 1
       from public.people p
       where p.archived_at is null
         and p.city_id = v_proposal.city_id
         and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g')
             = regexp_replace(upper(v_proposal.rg), '[^A-Z0-9]', '', 'g')
     ) then
    raise exception 'Já existe um indivíduo com esse RG nesta cidade. Vincule o cadastro existente.';
  end if;

  if exists (
    select 1
    from public.arrest_warrant_matches m
    where m.warrant_id = v_proposal.warrant_id
      and m.city_id = v_proposal.city_id
      and m.review_status = 'confirmed'
  ) then
    raise exception 'Esse mandado já foi vinculado. Atualize a página e revise o cadastro.';
  end if;

  if btrim(coalesce(v_proposal.filiation, '')) <> '' then
    v_notes := 'Filiação:' || E'\n' || btrim(v_proposal.filiation);
  end if;

  insert into public.people (
    city_id, full_name, cpf_digits, rg, birthday, address_primary, notes,
    occurrence_notes, occurrence_reference, created_by, updated_by
  ) values (
    v_proposal.city_id, v_proposal.full_name, v_proposal.cpf_digits, v_proposal.rg,
    v_proposal.birth_date, v_proposal.address_primary, v_notes,
    v_proposal.process_information, v_process_reference,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_person_id;

  insert into public.arrest_warrant_matches (
    city_id, warrant_id, person_id, match_basis, confidence, review_status,
    reviewed_by, reviewed_at
  ) values (
    v_proposal.city_id, v_proposal.warrant_id, v_person_id, 'manual_review', 100,
    'confirmed', (select auth.uid()), now()
  );

  update public.arrest_warrant_person_proposals
  set status = 'approved',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      resulting_person_id = v_person_id,
      updated_at = now()
  where id = v_proposal.id
    and status = 'pending';

  if not found then
    raise exception 'A proposta foi alterada durante a aprovação. Atualize e tente novamente.';
  end if;

  return v_person_id;
end;
$function$;

alter function public.admin_approve_arrest_warrant_person_proposal(uuid) owner to postgres;
revoke all on function public.admin_approve_arrest_warrant_person_proposal(uuid) from public, anon;
grant execute on function public.admin_approve_arrest_warrant_person_proposal(uuid) to authenticated;

create or replace function public.admin_reject_arrest_warrant_person_proposal(
  p_proposal_id uuid,
  p_review_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proposal public.arrest_warrant_person_proposals%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado.';
  end if;

  select *
    into v_proposal
  from public.arrest_warrant_person_proposals
  where id = p_proposal_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'A proposta já foi revisada ou não existe.';
  end if;

  if not public.can_manage_city(v_proposal.city_id) then
    raise exception 'Você não tem permissão administrativa para esta cidade.';
  end if;

  update public.arrest_warrant_person_proposals
  set status = 'rejected',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_notes = left(btrim(coalesce(p_review_notes, '')), 1000),
      updated_at = now()
  where id = v_proposal.id
    and status = 'pending';

  if not found then
    raise exception 'A proposta foi alterada durante a revisão. Atualize e tente novamente.';
  end if;
end;
$function$;

alter function public.admin_reject_arrest_warrant_person_proposal(uuid, text) owner to postgres;
revoke all on function public.admin_reject_arrest_warrant_person_proposal(uuid, text) from public, anon;
grant execute on function public.admin_reject_arrest_warrant_person_proposal(uuid, text) to authenticated;
