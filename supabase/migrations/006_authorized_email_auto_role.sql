-- The allowlist table was created manually in the original hosted project and
-- was not included in the initial migration history. Fresh local databases get
-- the table from a later, versioned migration, so defer this migration's work
-- when the table does not exist yet.
do $migration$
begin
  if to_regclass('public.authorized_emails') is not null then
    alter table public.authorized_emails
      alter column role set default 'operator';

    execute $function$
      create or replace function public.new_profile_for_auth_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        authorized_role public.app_role;
      begin
        select case
                 when ae.role in ('operator', 'admin') then ae.role
                 else 'pending'::public.app_role
               end
          into authorized_role
          from public.authorized_emails ae
         where lower(btrim(ae.email)) = lower(btrim(coalesce(new.email, '')))
         limit 1;

        insert into public.profiles(id, email, display_name, role)
        values (
          new.id,
          coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data->>'name', ''),
          coalesce(authorized_role, 'pending'::public.app_role)
        )
        on conflict (id) do nothing;

        return new;
      end;
      $body$;
    $function$;

    update public.profiles p
       set role = ae.role,
           updated_at = now()
      from public.authorized_emails ae
     where lower(btrim(p.email)) = lower(btrim(ae.email))
       and p.role = 'pending'
       and ae.role in ('operator', 'admin');
  end if;
end;
$migration$;
