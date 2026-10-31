-- Scope privileged proposal RPCs to the active city.
-- Existing data and photo files are not modified.
CREATE OR REPLACE FUNCTION public.submit_person_identity_change_proposal(
  p_person_id uuid, p_full_name text, p_cpf_digits text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_person public.people%rowtype;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf_digits, ''), '[^0-9]', '', 'g'), '');
  v_existing public.person_identity_change_proposals%rowtype;
  v_proposal_id uuid;
  v_city_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_use_app() THEN
    RAISE EXCEPTION 'A sessão não está autorizada para enviar sugestões.';
  END IF;
  IF public.is_admin() THEN
    RAISE EXCEPTION 'Administradores podem editar nome e CPF diretamente.';
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 180 THEN
    RAISE EXCEPTION 'O nome deve ter entre 2 e 180 caracteres.';
  END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'O CPF deve conter exatamente 11 números.';
  END IF;

  v_city_id := public.current_city_id();
  SELECT * INTO v_person
  FROM public.people p
  WHERE p.id = p_person_id AND p.city_id = v_city_id AND p.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indivíduo não encontrado ou indisponível nesta cidade.';
  END IF;
  IF v_person.full_name IS NOT DISTINCT FROM v_name
     AND v_person.cpf_digits IS NOT DISTINCT FROM v_cpf THEN
    RAISE EXCEPTION 'Nome e CPF não tiveram alterações para sugerir.';
  END IF;
  IF v_cpf IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.city_id = v_city_id AND p.archived_at IS NULL
      AND p.cpf_digits = v_cpf AND p.id <> p_person_id
  ) THEN
    RAISE EXCEPTION 'Este CPF já pertence a outro indivíduo.';
  END IF;

  SELECT * INTO v_existing
  FROM public.person_identity_change_proposals p
  WHERE p.person_id = p_person_id AND p.city_id = v_city_id AND p.status = 'pending'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.requested_by IS DISTINCT FROM (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'Já existe uma sugestão pendente para este cadastro. Aguarde a revisão do administrador.';
    END IF;
    UPDATE public.person_identity_change_proposals
    SET current_full_name = v_person.full_name,
        current_cpf_digits = v_person.cpf_digits,
        proposed_full_name = v_name,
        proposed_cpf_digits = v_cpf,
        created_at = now()
    WHERE id = v_existing.id AND city_id = v_city_id
    RETURNING id INTO v_proposal_id;
    RETURN v_proposal_id;
  END IF;

  INSERT INTO public.person_identity_change_proposals (
    person_id, current_full_name, current_cpf_digits,
    proposed_full_name, proposed_cpf_digits, requested_by, city_id
  ) VALUES (
    p_person_id, v_person.full_name, v_person.cpf_digits,
    v_name, v_cpf, (SELECT auth.uid()), v_city_id
  ) RETURNING id INTO v_proposal_id;

  RETURN v_proposal_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_person_identity_change_proposal(
  p_proposal_id uuid, p_approve boolean, p_review_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_proposal public.person_identity_change_proposals%rowtype;
  v_person public.people%rowtype;
  v_note text := left(btrim(coalesce(p_review_note, '')), 500);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem revisar estas sugestões.';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Escolha aprovar ou rejeitar a sugestão.';
  END IF;

  SELECT * INTO v_proposal
  FROM public.person_identity_change_proposals p
  WHERE p.id = p_proposal_id AND p.status = 'pending'
    AND (public.is_master_admin() OR p.city_id = public.current_city_id())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sugestão já foi revisada ou não existe nesta cidade.';
  END IF;

  SELECT * INTO v_person
  FROM public.people p
  WHERE p.id = v_proposal.person_id AND p.city_id = v_proposal.city_id
    AND p.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O cadastro relacionado não está mais disponível nesta cidade.';
  END IF;

  IF p_approve THEN
    IF v_proposal.proposed_cpf_digits IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.people p
      WHERE p.city_id = v_proposal.city_id AND p.archived_at IS NULL
        AND p.cpf_digits = v_proposal.proposed_cpf_digits AND p.id <> v_person.id
    ) THEN
      RAISE EXCEPTION 'Este CPF já pertence a outro indivíduo nesta cidade. A sugestão não foi aplicada.';
    END IF;

    IF v_person.full_name IS DISTINCT FROM v_proposal.proposed_full_name
       OR v_person.cpf_digits IS DISTINCT FROM v_proposal.proposed_cpf_digits THEN
      UPDATE public.people
      SET full_name = v_proposal.proposed_full_name,
          cpf_digits = v_proposal.proposed_cpf_digits,
          updated_by = (SELECT auth.uid())
      WHERE id = v_person.id AND city_id = v_proposal.city_id;
    END IF;

    UPDATE public.person_identity_change_proposals
    SET status = 'approved', reviewed_by = (SELECT auth.uid()),
        reviewed_at = now(), review_note = v_note
    WHERE id = v_proposal.id AND city_id = v_proposal.city_id;
  ELSE
    UPDATE public.person_identity_change_proposals
    SET status = 'rejected', reviewed_by = (SELECT auth.uid()),
        reviewed_at = now(),
        review_note = coalesce(nullif(v_note, ''), 'Rejeitada pelo administrador.')
    WHERE id = v_proposal.id AND city_id = v_proposal.city_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_vehicle_plate_change_proposal(
  p_vehicle_id uuid, p_plate text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_vehicle public.vehicles%rowtype;
  v_plate text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_existing public.vehicle_plate_change_proposals%rowtype;
  v_id uuid;
  v_city_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_use_app() THEN
    RAISE EXCEPTION 'Sessão não autorizada.';
  END IF;
  IF public.is_admin() THEN
    RAISE EXCEPTION 'Administradores podem editar a placa diretamente.';
  END IF;
  IF v_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' THEN
    RAISE EXCEPTION 'A placa deve seguir o padrão AAA0000 ou AAA0A00.';
  END IF;

  v_city_id := public.current_city_id();
  SELECT * INTO v_vehicle
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id AND v.city_id = v_city_id AND v.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado ou indisponível nesta cidade.';
  END IF;
  IF v_vehicle.plate = v_plate THEN
    RAISE EXCEPTION 'A placa não foi alterada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.city_id = v_city_id AND v.archived_at IS NULL
      AND upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) = v_plate
      AND v.id <> p_vehicle_id
  ) THEN
    RAISE EXCEPTION 'Esta placa já pertence a outro veículo.';
  END IF;

  SELECT * INTO v_existing
  FROM public.vehicle_plate_change_proposals p
  WHERE p.vehicle_id = p_vehicle_id AND p.city_id = v_city_id AND p.status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.requested_by IS DISTINCT FROM (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'Já existe uma sugestão pendente para este veículo.';
    END IF;
    UPDATE public.vehicle_plate_change_proposals
    SET current_plate = v_vehicle.plate, proposed_plate = v_plate, created_at = now()
    WHERE id = v_existing.id AND city_id = v_city_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.vehicle_plate_change_proposals (
    vehicle_id, current_plate, proposed_plate, requested_by, city_id
  ) VALUES (
    p_vehicle_id, v_vehicle.plate, v_plate, (SELECT auth.uid()), v_city_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_vehicle_plate_change_proposal(
  p_proposal_id uuid, p_approve boolean, p_review_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_proposal public.vehicle_plate_change_proposals%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_note text := left(btrim(coalesce(p_review_note, '')), 500);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem revisar estas sugestões.';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Escolha aprovar ou rejeitar a sugestão.';
  END IF;

  SELECT * INTO v_proposal
  FROM public.vehicle_plate_change_proposals p
  WHERE p.id = p_proposal_id AND p.status = 'pending'
    AND (public.is_master_admin() OR p.city_id = public.current_city_id())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sugestão já foi revisada ou não existe nesta cidade.';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles v
  WHERE v.id = v_proposal.vehicle_id AND v.city_id = v_proposal.city_id
    AND v.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O veículo relacionado não está mais disponível nesta cidade.';
  END IF;
  IF v_vehicle.plate IS DISTINCT FROM v_proposal.current_plate THEN
    RAISE EXCEPTION 'A placa do veículo mudou desde o envio. Atualize o cadastro e revise novamente.';
  END IF;

  IF p_approve AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.city_id = v_proposal.city_id AND v.archived_at IS NULL
      AND upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) = v_proposal.proposed_plate
      AND v.id <> v_vehicle.id
  ) THEN
    RAISE EXCEPTION 'Esta placa já pertence a outro veículo nesta cidade.';
  END IF;

  IF p_approve THEN
    UPDATE public.vehicles
    SET plate = v_proposal.proposed_plate, updated_by = (SELECT auth.uid()), updated_at = now()
    WHERE id = v_vehicle.id AND city_id = v_proposal.city_id;
  END IF;
  UPDATE public.vehicle_plate_change_proposals
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = (SELECT auth.uid()), review_note = v_note, reviewed_at = now()
  WHERE id = v_proposal.id AND city_id = v_proposal.city_id;
END;
$function$;

-- The functions bypass RLS by design; enforce explicit city boundaries inside them.
ALTER FUNCTION public.submit_person_identity_change_proposal(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_review_person_identity_change_proposal(uuid, boolean, text) OWNER TO postgres;
ALTER FUNCTION public.submit_vehicle_plate_change_proposal(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.admin_review_vehicle_plate_change_proposal(uuid, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_person_identity_change_proposal(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_person_identity_change_proposal(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_vehicle_plate_change_proposal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_vehicle_plate_change_proposal(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_person_identity_change_proposal(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_person_identity_change_proposal(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_vehicle_plate_change_proposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_vehicle_plate_change_proposal(uuid, boolean, text) TO authenticated;
