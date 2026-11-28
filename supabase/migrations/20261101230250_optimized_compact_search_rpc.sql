-- Shared normalization used by the trigram indexes and compact search RPCs.
CREATE OR REPLACE FUNCTION public.search_normalize(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT extensions.unaccent('extensions.unaccent', lower(coalesce(value, '')));
$function$;

-- Optimize list searches by returning only fields used by result cards.
-- Trigram indexes support the normalized contains predicates; archived records stay excluded.
CREATE INDEX IF NOT EXISTS people_search_text_trgm_idx ON public.people USING gin (
  public.search_normalize(
    coalesce(full_name,'') || ' ' || coalesce(rg,'') || ' ' || coalesce(registration,'') || ' ' ||
    coalesce(alias,'') || ' ' || coalesce(address_primary,'') || ' ' || coalesce(address_secondary,'') || ' ' ||
    coalesce(notes,'') || ' ' || coalesce(occurrence_notes,'') || ' ' || coalesce(occurrence_reference,'')
  ) extensions.gin_trgm_ops
) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS vehicles_search_text_trgm_idx ON public.vehicles USING gin (
  public.search_normalize(coalesce(plate,'') || ' ' || coalesce(make,'') || ' ' || coalesce(model,'') || ' ' || coalesce(color,'') || ' ' || coalesce(notes,'')) extensions.gin_trgm_ops
) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.search_people_list(search_term text, result_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, full_name text, cpf_digits text, rg text, photo_path text)
LANGUAGE sql STABLE SET search_path TO ''
AS $function$
WITH q AS (SELECT public.search_normalize(trim(coalesce(search_term,''))) AS term)
SELECT p.id,p.full_name,p.cpf_digits,p.rg,p.photo_path
FROM public.people p CROSS JOIN q
WHERE p.archived_at IS NULL AND length(q.term) >= 2 AND (
  public.search_normalize(
    coalesce(p.full_name,'') || ' ' || coalesce(p.rg,'') || ' ' || coalesce(p.registration,'') || ' ' ||
    coalesce(p.alias,'') || ' ' || coalesce(p.address_primary,'') || ' ' || coalesce(p.address_secondary,'') || ' ' ||
    coalesce(p.notes,'') || ' ' || coalesce(p.occurrence_notes,'') || ' ' || coalesce(p.occurrence_reference,'')
  ) LIKE '%' || q.term || '%'
  OR (pg_catalog.regexp_replace(q.term,'[^0-9]','','g') <> '' AND coalesce(p.cpf_digits,'') LIKE '%' || pg_catalog.regexp_replace(q.term,'[^0-9]','','g') || '%')
)
ORDER BY p.full_name
LIMIT least(greatest(coalesce(result_limit,100),1),100)
$function$;

CREATE OR REPLACE FUNCTION public.search_vehicles_list(search_term text, result_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, plate text, make text, model text, color text, photo_path text)
LANGUAGE sql STABLE SET search_path TO ''
AS $function$
WITH q AS (
  SELECT public.search_normalize(trim(coalesce(search_term,''))) AS term,
         pg_catalog.regexp_replace(trim(coalesce(search_term,'')), '[^0-9]', '', 'g') AS digits
)
SELECT v.id,v.plate,v.make,v.model,v.color,v.photo_path
FROM public.vehicles v CROSS JOIN q
WHERE v.archived_at IS NULL AND length(q.term) >= 2 AND (
  public.search_normalize(coalesce(v.plate,'') || ' ' || coalesce(v.make,'') || ' ' ||
    coalesce(v.model,'') || ' ' || coalesce(v.color,'') || ' ' || coalesce(v.notes,'')) LIKE '%' || q.term || '%'
  OR EXISTS (
    SELECT 1 FROM public.person_vehicle_links l
    JOIN public.people p ON p.id=l.person_id
    WHERE l.vehicle_id=v.id AND l.active=true AND p.archived_at IS NULL AND (
      public.search_normalize(
        coalesce(p.full_name,'') || ' ' || coalesce(p.rg,'') || ' ' || coalesce(p.registration,'') || ' ' ||
        coalesce(p.alias,'') || ' ' || coalesce(p.address_primary,'') || ' ' || coalesce(p.address_secondary,'') || ' ' ||
        coalesce(p.notes,'') || ' ' || coalesce(p.occurrence_notes,'') || ' ' || coalesce(p.occurrence_reference,'')
      ) LIKE '%' || q.term || '%'
      OR (q.digits <> '' AND coalesce(p.cpf_digits,'') LIKE '%' || q.digits || '%')
    )
  )
)
ORDER BY v.plate
LIMIT least(greatest(coalesce(result_limit,100),1),100)
$function$;

GRANT EXECUTE ON FUNCTION public.search_people_list(text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_vehicles_list(text,integer) TO authenticated, service_role;
