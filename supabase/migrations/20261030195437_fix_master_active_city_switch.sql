-- Give the protected RPC an owner able to update profiles despite RLS.
-- The function remains SECURITY DEFINER and validates the caller's membership.
ALTER FUNCTION public.set_active_city(uuid) OWNER TO postgres;
