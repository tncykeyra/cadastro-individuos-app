-- Fix city reassignment and active-city switching without changing application records.
begin;

create or replace function public.guard_profile_city_update()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null or public.is_master_admin() then return new; end if;
  if new.role is distinct from old.role or lower(new.email) is distinct from lower(old.email) then
    raise exception 'Somente o administrador master pode alterar perfil ou e-mail.' using errcode='42501';
  end if;
  if new.active_city_id is distinct from old.active_city_id and
     (new.active_city_id is null or not exists (
       select 1 from public.city_memberships m join public.cities c on c.id=m.city_id
       where m.user_id=(select auth.uid()) and m.city_id=new.active_city_id
         and m.role in ('operator','admin') and c.active
     )) then
    raise exception 'A cidade ativa precisa estar atribuída à sua conta.' using errcode='42501';
  end if;
  return new;
end;
$function$;

create or replace function public.set_active_city(p_city_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Entre novamente para selecionar a cidade.' using errcode='42501';
  end if;
  if public.is_master_admin() then
    if not exists(select 1 from public.cities c where c.id=p_city_id and c.active) then
      raise exception 'Cidade não encontrada ou desativada.' using errcode='22023';
    end if;
  elsif not exists (
    select 1 from public.city_memberships m join public.cities c on c.id=m.city_id
    where m.user_id=(select auth.uid()) and m.city_id=p_city_id
      and m.role in ('operator','admin') and c.active
  ) then
    raise exception 'Você não tem acesso a esta cidade.' using errcode='42501';
  end if;
  update public.profiles set active_city_id=p_city_id where id=(select auth.uid());
  if not found then raise exception 'Perfil não encontrado.'; end if;
end;
$function$;

create or replace function public.master_assign_city_user(p_user_id uuid,p_city_id uuid,p_role text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null or not public.is_master_admin() then
    raise exception 'Somente o administrador master pode atribuir usuários.' using errcode='42501';
  end if;
  if p_role not in ('operator','admin') then raise exception 'Perfil de cidade inválido.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id and p.role in ('operator','admin')) then
    raise exception 'O usuário ainda não concluiu o primeiro acesso.' using errcode='22023';
  end if;
  if not exists(select 1 from public.cities c where c.id=p_city_id and c.active) then
    raise exception 'Cidade não encontrada ou desativada.' using errcode='22023';
  end if;
  if exists(select 1 from public.city_memberships m where m.user_id=p_user_id and m.is_master) then
    raise exception 'O administrador master não pode ser atribuído como usuário de cidade.' using errcode='42501';
  end if;

  -- A local account works in one city; reassignment changes access only.
  delete from public.city_memberships m where m.user_id=p_user_id and not m.is_master and m.city_id<>p_city_id;
  insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
    values(p_user_id,p_city_id,p_role,false,(select auth.uid()))
  on conflict(user_id,city_id) do update
    set role=excluded.role,is_master=false,created_by=(select auth.uid()),created_at=now();

  -- auth.uid() here is the master making the assignment, not the target account.
  update public.profiles set active_city_id=p_city_id where id=p_user_id;
end;
$function$;

-- Repair the two requested account assignments. Records, photos, and history stay in place.
do $repair$
declare v_lencois uuid; v_agudos uuid; v_antonio uuid; v_malas uuid;
begin
  select id into v_lencois from public.cities where slug='lencois-paulista' and active;
  if v_lencois is null then select id into v_lencois from public.cities where name='Lençóis Paulista' and active; end if;
  select id into v_agudos from public.cities where slug='agudos' and active;
  if v_agudos is null then select id into v_agudos from public.cities where name='Agudos' and active; end if;

  select id into v_antonio from public.profiles where lower(email)='antoniobrn13@gmail.com';
  if v_antonio is not null and v_lencois is not null then
    update public.city_memberships set role='operator'
      where user_id=v_antonio and city_id=v_lencois and not is_master;
    if not exists(select 1 from public.city_memberships where user_id=v_antonio and city_id=v_lencois) then
      insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
        values(v_antonio,v_lencois,'operator',false,null);
    end if;
    update public.profiles set active_city_id=v_lencois where id=v_antonio;
  end if;

  select id into v_malas from public.profiles where lower(email)='malas.agudos@gmail.com';
  if v_malas is not null and v_agudos is not null then
    delete from public.city_memberships where user_id=v_malas and not is_master and city_id<>v_agudos;
    insert into public.city_memberships(user_id,city_id,role,is_master,created_by)
      values(v_malas,v_agudos,'admin',false,null)
    on conflict(user_id,city_id) do update set role='admin',is_master=false;
    update public.profiles set active_city_id=v_agudos where id=v_malas;
  end if;
end;
$repair$;

commit;