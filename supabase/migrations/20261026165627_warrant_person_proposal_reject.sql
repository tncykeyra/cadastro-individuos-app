create or replace function public.admin_reject_arrest_warrant_person_proposal(
  p_proposal_id uuid,
  p_review_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Apenas administradores podem rejeitar propostas.';
  end if;
  update public.arrest_warrant_person_proposals
  set status = 'rejected',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_notes = left(btrim(coalesce(p_review_notes, '')), 1000),
      updated_at = now()
  where id = p_proposal_id and status = 'pending';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'A proposta já foi revisada ou não existe.';
  end if;
end;
$$;

revoke all on function public.admin_suggest_arrest_warrant_matches_with_rg(uuid, text) from public, anon;
grant execute on function public.admin_suggest_arrest_warrant_matches_with_rg(uuid, text) to authenticated;
revoke all on function public.admin_create_arrest_warrant_person_proposal(uuid, text, text, text, date, text, text, text) from public, anon;
grant execute on function public.admin_create_arrest_warrant_person_proposal(uuid, text, text, text, date, text, text, text) to authenticated;
revoke all on function public.admin_approve_arrest_warrant_person_proposal(uuid) from public, anon;
grant execute on function public.admin_approve_arrest_warrant_person_proposal(uuid) to authenticated;
revoke all on function public.admin_reject_arrest_warrant_person_proposal(uuid, text) from public, anon;
grant execute on function public.admin_reject_arrest_warrant_person_proposal(uuid, text) to authenticated;
