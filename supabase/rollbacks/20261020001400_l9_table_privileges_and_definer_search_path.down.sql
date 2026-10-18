-- Rollback for L-9: restore table privileges and previous search_path values.
GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLES TO anon, authenticated;
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('security_private.search_path_changes') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT * FROM security_private.search_path_changes WHERE migration = '20261020001400_l9' LOOP
    IF r.old_search_path = '<unset>' THEN
      EXECUTE format('ALTER ROUTINE %s RESET search_path', r.routine);
    ELSE
      EXECUTE format('ALTER ROUTINE %s SET search_path = %s', r.routine,
                     CASE WHEN btrim(r.old_search_path) IN ('', '""') THEN '''''' ELSE r.old_search_path END);
    END IF;
  END LOOP;
  DELETE FROM security_private.search_path_changes WHERE migration = '20261020001400_l9';
END $$;
