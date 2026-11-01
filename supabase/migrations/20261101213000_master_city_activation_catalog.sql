-- Master-only city catalog and activation controls.
-- Existing records and memberships are preserved.
CREATE OR REPLACE FUNCTION public.master_list_city_catalog()
RETURNS TABLE(id uuid, name text, slug text, active boolean, assigned_users bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Somente o administrador master pode consultar todas as cidades.'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.slug, c.active,
         count(m.user_id)::bigint AS assigned_users
  FROM public.cities c
  LEFT JOIN public.city_memberships m
    ON m.city_id = c.id AND NOT m.is_master
  GROUP BY c.id, c.name, c.slug, c.active
  ORDER BY c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.master_activate_city(p_city_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Somente o administrador master pode ativar cidades.'
      USING errcode = '42501';
  END IF;

  UPDATE public.cities
  SET active = true
  WHERE id = p_city_id
  RETURNING true INTO v_updated;

  IF NOT COALESCE(v_updated, false) THEN
    RAISE EXCEPTION 'Cidade não encontrada.'
      USING errcode = 'P0002';
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.master_create_city(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text;
  v_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Somente o administrador master pode criar cidades.'
      USING errcode = '42501';
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Informe um nome de cidade válido.'
      USING errcode = '22023';
  END IF;

  v_slug := trim(both '-' from regexp_replace(lower(extensions.unaccent(v_name)), '[^a-z0-9]+', '-', 'g'));
  IF v_slug = '' THEN
    RAISE EXCEPTION 'O nome da cidade não gerou um identificador válido.'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.cities(name, slug, active, created_by)
  VALUES (v_name, v_slug, true, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  INSERT INTO public.city_memberships(user_id, city_id, role, is_master, created_by)
  VALUES ((SELECT auth.uid()), v_id, 'master', true, (SELECT auth.uid()));

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma cidade com esse nome.'
    USING errcode = '23505';
END;
$function$;

REVOKE ALL ON FUNCTION public.master_list_city_catalog() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.master_activate_city(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_list_city_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_activate_city(uuid) TO authenticated;