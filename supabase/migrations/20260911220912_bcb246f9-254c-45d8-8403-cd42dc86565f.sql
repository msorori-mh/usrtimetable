CREATE OR REPLACE FUNCTION public.effective_room_type_capacity(
  p_college_id uuid,
  p_room_type_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT MIN(r.capacity)::integer
  FROM public.rooms r
  WHERE r.college_id = p_college_id
    AND r.room_type_id = p_room_type_id
    AND COALESCE(r.is_active, false) = true
    AND r.capacity IS NOT NULL
    AND r.capacity > 0
  HAVING COUNT(DISTINCT r.capacity) = 1
$$;

REVOKE ALL ON FUNCTION public.effective_room_type_capacity(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_room_type_capacity(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_room_type_capacity(uuid, uuid) TO service_role;

UPDATE public.room_types rt
SET default_capacity = e.cap
FROM (
  SELECT r.college_id, r.room_type_id, MIN(r.capacity)::integer AS cap
  FROM public.rooms r
  WHERE COALESCE(r.is_active, false) = true
    AND r.room_type_id IS NOT NULL
    AND r.capacity IS NOT NULL
    AND r.capacity > 0
  GROUP BY r.college_id, r.room_type_id
  HAVING COUNT(DISTINCT r.capacity) = 1
) e
WHERE rt.id = e.room_type_id
  AND rt.college_id = e.college_id
  AND COALESCE(rt.default_capacity, -1) <> e.cap;

UPDATE public.delivery_groups dg
SET capacity_limit = eff.cap
FROM public.plan_course_components pcc
CROSS JOIN LATERAL (
  SELECT public.effective_room_type_capacity(pcc.college_id, pcc.required_room_type_id) AS cap
) eff
WHERE pcc.id = dg.component_id
  AND pcc.college_id = dg.college_id
  AND pcc.explicit_group_size IS NULL
  AND COALESCE(dg.is_obsolete, false) = false
  AND eff.cap IS NOT NULL
  AND COALESCE(dg.capacity_limit, -1) <> eff.cap;
