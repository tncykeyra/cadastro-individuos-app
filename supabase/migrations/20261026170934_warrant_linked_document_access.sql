
create or replace function public.count_active_arrest_warrants()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.can_use_app() then
    raise exception 'Acesso não autorizado.';
  end if;

  if public.is_admin() then
    return (
      select count(*)
      from public.arrest_warrants w
      where w.status in ('pending','discharge_reported')
    );
  end if;

  return (
    select count(distinct w.id)
    from public.arrest_warrants w
    join public.arrest_warrant_matches m
      on m.warrant_id = w.id and m.review_status = 'confirmed'
    join public.people p
      on p.id = m.person_id and p.archived_at is null
    where w.status in ('pending','discharge_reported')
  );
end;
$$;

revoke all on function public.count_active_arrest_warrants() from public, anon;
grant execute on function public.count_active_arrest_warrants() to authenticated;

drop policy if exists arrest_warrant_documents_admin_read
  on public.arrest_warrant_documents;
drop policy if exists arrest_warrant_documents_staff_read_confirmed
  on public.arrest_warrant_documents;
create policy arrest_warrant_documents_staff_read_confirmed
  on public.arrest_warrant_documents
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.can_use_app()
      and exists (
        select 1
        from public.arrest_warrant_matches m
        join public.people p on p.id = m.person_id
        where m.warrant_id = arrest_warrant_documents.warrant_id
          and m.review_status = 'confirmed'
          and p.archived_at is null
      )
    )
  );

drop policy if exists warrant_documents_storage_admin_read
  on storage.objects;
drop policy if exists warrant_documents_storage_staff_read_confirmed
  on storage.objects;
create policy warrant_documents_storage_staff_read_confirmed
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'warrant-documents'
    and (
      public.is_admin()
      or (
        public.can_use_app()
        and exists (
          select 1
          from public.arrest_warrant_documents d
          join public.arrest_warrant_matches m on m.warrant_id = d.warrant_id
          join public.people p on p.id = m.person_id
          where d.storage_path = storage.objects.name
            and m.review_status = 'confirmed'
            and p.archived_at is null
        )
      )
    )
  );
