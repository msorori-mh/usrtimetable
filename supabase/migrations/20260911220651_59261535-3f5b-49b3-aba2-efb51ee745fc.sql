CREATE OR REPLACE FUNCTION public._probe_dollar_quote() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v int;
BEGIN
  v := 1;
  RETURN v;
END
$$;

DROP FUNCTION public._probe_dollar_quote();
