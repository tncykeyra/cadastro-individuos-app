-- Permite registrar uma baixa sem comprovante ou vínculo confirmado.
-- A informação continua em revisão e somente um administrador pode encerrar o mandado.
create or replace function public.report_arrest_warrant_discharge(
  p_warrant_id uuid,
  p_discharge_date date,
  p_reference text,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_discharge_date is null or p_discharge_date > current_date then
    raise exception 'Informe uma data válida para a baixa.';
  end if;

  update public.arrest_warrants
  set status = 'discharge_reported',
      discharge_reported_at = now(),
      discharge_reported_date = p_discharge_date,
      discharge_reference = coalesce(nullif(btrim(coalesce(p_reference, '')), ''), ''),
      discharge_notes = btrim(coalesce(p_notes, '')),
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_warrant_id and status = 'pending';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'O mandado não está mais pendente. Atualize a tela e confira o status.';
  end if;
end;
$$;
