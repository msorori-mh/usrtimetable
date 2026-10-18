-- L-9: anon/authenticated hold no TRUNCATE/TRIGGER/REFERENCES on public tables
-- (now or by default), and every SECURITY DEFINER routine pins pg_temp last in
-- its search_path.
BEGIN;
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(DISTINCT c.relname || ':' || r.rolname || ':' || pr.p, ', ') INTO v
    FROM pg_class c
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pr(p)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
     AND has_table_privilege(r.rolname, c.oid, pr.p);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'L-9: excess table privileges: %', left(v, 400); END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%'
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c
                      WHERE c LIKE 'search_path=%' AND (c LIKE '%, pg_temp' OR c = 'search_path=pg_temp'));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'L-9: definer routines without trailing pg_temp: %', left(v, 400); END IF;
END $$;

-- a table created later by the owner does not hand TRUNCATE to anon/authenticated
CREATE TABLE public.__l9_probe (id int);
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.__l9_probe', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.__l9_probe', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L-9: default privileges still grant TRUNCATE';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.__l9_probe', 'SELECT') THEN
    RAISE EXCEPTION 'L-9: default SELECT grant unexpectedly removed';
  END IF;
END $$;

-- behaviour: authenticated cannot TRUNCATE a table (RLS bypass)
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  TRUNCATE public.audit_logs;
  RAISE EXCEPTION 'L-9: authenticated truncated audit_logs';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
ROLLBACK;
