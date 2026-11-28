create or replace function public.admin_create_arrest_warrant_person_proposal(
  p_warrant_id uuid,
  p_full_name text,
  p_rg text default '',
  p_cpf_digits text default null,
  p_birth_date date default null,
  p_address_primary text default '',
  p_filiation text default '',
  p_process_information text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal_id uuid;
  v_rg_normalized text := regexp_replace(upper(coalesce(p_rg, '')), '[^A-Z0-9]', '', 'g');
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem criar propostas de indivíduo.';
  end if;
  if length(v_name) < 2 or length(v_name) > 180 then
    raise exception 'Confira o nome reconhecido antes de enviar para aprovação.';
  end if;
  if p_cpf_digits is not null and p_cpf_digits !~ '^[0-9]{11}$' then
    raise exception 'O CPF deve conter exatamente 11 números.';
  end if;
  if length(coalesce(p_rg, '')) > 80
     or length(coalesce(p_address_primary, '')) > 1000
     or length(coalesce(p_filiation, '')) > 2000
     or length(coalesce(p_process_information, '')) > 12000 then
    raise exception 'Um dos campos excede o limite permitido.';
  end if;
  if not exists (
    select 1 from public.arrest_warrants w
    where w.id = p_warrant_id and w.status in ('pending','discharge_reported')
  ) then
    raise exception 'O mandado precisa estar ativo para receber a proposta.';
  end if;
  if exists (
    select 1 from public.arrest_warrant_matches m
    where m.warrant_id = p_warrant_id and m.review_status in ('candidate','confirmed')
  ) then
    raise exception 'Há uma possível correspondência. Revise o candidato antes de criar outra pessoa.';
  end if;
  if p_cpf_digits is not null and exists (
    select 1 from public.people p
    where p.archived_at is null and p.cpf_digits = p_cpf_digits
  ) then
    raise exception 'Já existe um cadastro com esse CPF. Revise e vincule o indivíduo existente.';
  end if;
  if v_rg_normalized <> '' and exists (
    select 1 from public.people p
    where p.archived_at is null
      and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g') = v_rg_normalized
  ) then
    raise exception 'Já existe um cadastro com esse RG. Revise e vincule o indivíduo existente.';
  end if;

  insert into public.arrest_warrant_person_proposals (
    warrant_id, full_name, cpf_digits, rg, birth_date, address_primary,
    filiation, process_information, created_by
  ) values (
    p_warrant_id, v_name, nullif(btrim(coalesce(p_cpf_digits, '')), ''),
    btrim(coalesce(p_rg, '')), p_birth_date, btrim(coalesce(p_address_primary, '')),
    btrim(coalesce(p_filiation, '')), btrim(coalesce(p_process_information, '')),
    (select auth.uid())
  )
  returning id into v_proposal_id;

  return v_proposal_id;
end;
$$;

