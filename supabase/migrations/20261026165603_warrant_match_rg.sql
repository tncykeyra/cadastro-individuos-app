create or replace function public.admin_suggest_arrest_warrant_matches_with_rg(
  p_warrant_id uuid,
  p_rg text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warrant public.arrest_warrants%rowtype;
  v_rg_normalized text := regexp_replace(upper(coalesce(p_rg, '')), '[^A-Z0-9]', '', 'g');
  v_inserted integer := 0;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem revisar correspondências.';
  end if;

  select * into v_warrant
  from public.arrest_warrants
  where id = p_warrant_id and status in ('pending','discharge_reported');

  if not found then
    raise exception 'Mandado não encontrado ou não está ativo.';
  end if;

  insert into public.arrest_warrant_matches
    (warrant_id, person_id, match_basis, confidence, review_status)
  select
    v_warrant.id,
    p.id,
    case
      when v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits then 'cpf_exact'
      when v_rg_normalized <> ''
        and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g') = v_rg_normalized then 'manual_review'
      when p.birthday is not null and p.birthday = v_warrant.birth_date then 'name_birthdate'
      else 'name_exact'
    end,
    case
      when v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits then 100
      when v_rg_normalized <> ''
        and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g') = v_rg_normalized then 95
      when p.birthday is not null and p.birthday = v_warrant.birth_date then 90
      else 75
    end,
    'candidate'
  from public.people p
  where p.archived_at is null
    and (
      (v_warrant.cpf_digits is not null and p.cpf_digits = v_warrant.cpf_digits)
      or (
        v_rg_normalized <> ''
        and regexp_replace(upper(coalesce(p.rg, '')), '[^A-Z0-9]', '', 'g') = v_rg_normalized
      )
      or (
        (v_warrant.cpf_digits is null or p.cpf_digits is null)
        and public.normalize_arrest_warrant_name(p.full_name)
          = public.normalize_arrest_warrant_name(v_warrant.full_name)
      )
    )
  on conflict (warrant_id, person_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

