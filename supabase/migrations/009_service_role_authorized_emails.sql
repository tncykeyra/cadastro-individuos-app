-- The invite-user Edge Function uses the service role to manage authorized emails.
-- Keep this grant scoped to this table; the service key remains server-side only.
grant select, insert, update, delete
  on table public.authorized_emails
  to service_role;
