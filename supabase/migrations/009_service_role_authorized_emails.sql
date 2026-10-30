-- The authorized_emails table predates the versioned migration history in
-- the hosted project. Fresh databases create it in a later baseline migration.
do $migration$
begin
  if to_regclass('public.authorized_emails') is not null then
    grant select, insert, update, delete
      on table public.authorized_emails
      to service_role;
  end if;
end;
$migration$;
