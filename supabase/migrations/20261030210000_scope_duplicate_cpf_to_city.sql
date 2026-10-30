-- Keep CPF uniqueness within each municipality. The same person may be registered
-- independently in two city databases; duplicate CPFs within one city remain blocked.
create or replace function public.reject_duplicate_cpf_on_write()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_city_id uuid;
begin
  if new.cpf_digits is null then
    return new;
  end if;

  v_city_id := new.city_id;
  if v_city_id is null then
    raise exception 'A cidade do cadastro é obrigatória para validar o CPF.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_city_id::text || ':' || new.cpf_digits, 0)
  );

  if tg_op = 'UPDATE'
     and new.cpf_digits is not distinct from old.cpf_digits
     and new.city_id is not distinct from old.city_id then
    return new;
  end if;

  if exists (
    select 1
    from public.people p
    where p.city_id = v_city_id
      and p.cpf_digits = new.cpf_digits
      and p.id <> new.id
  ) then
    raise exception 'Já existe um cadastro com este CPF nesta cidade.'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;
