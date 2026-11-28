-- Keep city-context predicates out of recursive authenticated RLS evaluation.
-- The function bodies remain unchanged and continue to scope all results to auth.uid().
-- Their existing empty search_path settings remain in place.
ALTER FUNCTION public.can_use_app() OWNER TO postgres;
ALTER FUNCTION public.current_city_id() OWNER TO postgres;
ALTER FUNCTION public.is_master_admin() OWNER TO postgres;
ALTER FUNCTION public.can_manage_city(uuid) OWNER TO postgres;
ALTER FUNCTION public.is_admin() OWNER TO postgres;
ALTER FUNCTION public.list_my_cities() OWNER TO postgres;
