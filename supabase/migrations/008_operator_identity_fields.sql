-- Operadores podem atualizar os demais campos, mas não identidade (nome/CPF).
create or replace function public.prevent_operator_identity_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (select public.is_admin()) and (
    new.full_name is distinct from old.full_name
    or new.cpf_digits is distinct from old.cpf_digits
  ) then
    raise exception 'Apenas administradores podem alterar nome ou CPF';
  end if;
  return new;
end;
$$;

drop trigger if exists people_identity_admin_only on public.people;
create trigger people_identity_admin_only
  before update on public.people
  for each row execute function public.prevent_operator_identity_changes();

