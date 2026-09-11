CREATE OR REPLACE FUNCTION public._probe_c(p_fn text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text;
BEGIN
  v_def := p_fn;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PATCH_FAILED';
  END IF;
  EXECUTE pg_catalog.replace(v_def, 'a', 'b');
END
$$;

DROP FUNCTION public._probe_c(text);
