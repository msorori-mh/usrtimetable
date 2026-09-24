CREATE OR REPLACE FUNCTION public._probe_a() RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT 1
$$;

REVOKE ALL ON FUNCTION public._probe_a() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._probe_a() TO authenticated;

CREATE OR REPLACE FUNCTION public._probe_b(p_fn text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text;
BEGIN
  v_def := p_fn;
  RETURN;
END
$$;

DROP FUNCTION public._probe_b(text);
DROP FUNCTION public._probe_a();
