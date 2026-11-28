-- These functions are called by RLS policies and by the signed-in app.
-- Grant only to authenticated; anonymous users cannot execute them.
GRANT EXECUTE ON FUNCTION public.can_use_app() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_city_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_city(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_cities() TO authenticated;
