CREATE OR REPLACE FUNCTION public._probe_sql_body2(p_id uuid) RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT MIN(r.capacity)::integer
  FROM public.rooms r
  WHERE r.college_id = p_id
  HAVING COUNT(DISTINCT r.capacity) = 1
$$;

CREATE OR REPLACE FUNCTION public._probe_plpgsql3() RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_def
  FROM pg_catalog.pg_proc p WHERE p.proname = 'now';
  IF v_def IS NULL THEN
    RETURN;
  END IF;
END
$$;

DROP FUNCTION public._probe_sql_body2(uuid);
DROP FUNCTION public._probe_plpgsql3();
