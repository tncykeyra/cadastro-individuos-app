-- Fix proposal RPC ownership and allow additive multi-city memberships.
-- No data is deleted or rewritten by this migration.

ALTER FUNCTION public.submit_person_identity_change_proposal(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_review_person_identity_change_proposal(uuid, boolean, text) OWNER TO postgres;
ALTER FUNCTION public.submit_vehicle_plate_change_proposal(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.admin_review_vehicle_plate_change_proposal(uuid, boolean, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.master_assign_user_cities(
  p_user_id uuid,
  p_city_ids uuid[],
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_requested_count integer;
  v_active_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Somente o administrador master pode atribuir usuários.' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('operator', 'admin') THEN
    RAISE EXCEPTION 'Perfil de cidade inválido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.role IN ('operator', 'admin')
  ) THEN
    RAISE EXCEPTION 'O usuário ainda não concluiu o primeiro acesso.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.city_memberships m
    WHERE m.user_id = p_user_id AND m.is_master
  ) THEN
    RAISE EXCEPTION 'O administrador master não pode ser atribuído como usuário de cidade.' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT requested.city_id)
  INTO v_requested_count
  FROM unnest(coalesce(p_city_ids, ARRAY[]::uuid[])) AS requested(city_id);
  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma cidade.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.city_id)
  INTO v_active_count
  FROM unnest(coalesce(p_city_ids, ARRAY[]::uuid[])) AS requested(city_id)
  JOIN public.cities c ON c.id = requested.city_id AND c.active;
  IF v_active_count <> v_requested_count THEN
    RAISE EXCEPTION 'Uma ou mais cidades selecionadas estão indisponíveis.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.city_memberships(user_id, city_id, role, is_master, created_by)
  SELECT p_user_id, requested.city_id, p_role, false, (SELECT auth.uid())
  FROM (
    SELECT DISTINCT city_id
    FROM unnest(p_city_ids) AS selected(city_id)
  ) AS requested
  ON CONFLICT (user_id, city_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_master = false,
        created_by = (SELECT auth.uid()),
        created_at = now();

  -- Keep the current city when its membership is still valid; otherwise select an assigned city.
  UPDATE public.profiles p
  SET active_city_id = (
    SELECT m.city_id
    FROM public.city_memberships m
    JOIN public.cities c ON c.id = m.city_id AND c.active
    WHERE m.user_id = p_user_id AND m.role IN ('operator', 'admin')
    ORDER BY (m.city_id = p.active_city_id) DESC, m.created_at ASC
    LIMIT 1
  )
  WHERE p.id = p_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.city_memberships m
      JOIN public.cities c ON c.id = m.city_id AND c.active
      WHERE m.user_id = p_user_id
        AND m.city_id = p.active_city_id
        AND m.role IN ('operator', 'admin')
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.master_assign_user_cities(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_assign_user_cities(uuid, uuid[], text) TO authenticated;
ALTER FUNCTION public.master_assign_user_cities(uuid, uuid[], text) OWNER TO postgres;

-- Replace the legacy unique index: multiple city memberships are now valid.
DROP INDEX IF EXISTS public.city_memberships_one_city_per_user;

-- Preserve existing RPC callers while changing single-city assignment to additive behavior.
CREATE OR REPLACE FUNCTION public.master_assign_city_user(
  p_user_id uuid,
  p_city_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.master_assign_user_cities(p_user_id, ARRAY[p_city_id], p_role);
END;
$function$;

REVOKE ALL ON FUNCTION public.master_assign_city_user(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_assign_city_user(uuid, uuid, text) TO authenticated;
