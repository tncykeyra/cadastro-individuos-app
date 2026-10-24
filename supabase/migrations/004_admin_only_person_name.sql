-- Require administrator privileges to change an individual's name, even through direct API requests.
create or replace function public.stamp_record_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at and not public.is_admin() then
    raise exception 'Apenas administrador pode arquivar ou restaurar registros';
  end if;

  if tg_table_name = 'people'
     and new.full_name is distinct from old.full_name
     and not public.is_admin() then
    raise exception 'Apenas administrador pode alterar o nome do indivíduo';
  end if;

  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
