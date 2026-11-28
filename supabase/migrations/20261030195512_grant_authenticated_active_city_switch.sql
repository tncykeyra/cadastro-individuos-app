-- Expose only the validated city-switch RPC to signed-in users.
GRANT EXECUTE ON FUNCTION public.set_active_city(uuid) TO authenticated;
