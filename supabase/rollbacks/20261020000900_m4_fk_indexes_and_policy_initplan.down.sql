-- Rollback for M-4: restore the original policy expressions and drop only the
-- indexes this migration created.
DO $$
DECLARE r record; v_sql text;
BEGIN
  IF to_regclass('security_private.policy_rewrites') IS NOT NULL THEN
    FOR r IN SELECT * FROM security_private.policy_rewrites WHERE migration = '20261020000900_m4' LOOP
      IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = r.table_name AND policyname = r.policy_name) THEN
        v_sql := format('ALTER POLICY %I ON public.%I', r.policy_name, r.table_name);
        IF r.old_qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || r.old_qual || ')'; END IF;
        IF r.old_with_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || r.old_with_check || ')'; END IF;
        EXECUTE v_sql;
      END IF;
    END LOOP;
    DELETE FROM security_private.policy_rewrites WHERE migration = '20261020000900_m4';
  END IF;
  IF to_regclass('security_private.added_indexes') IS NOT NULL THEN
    FOR r IN SELECT * FROM security_private.added_indexes WHERE migration = '20261020000900_m4' LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I.%I', r.schema_name, r.index_name);
    END LOOP;
    DELETE FROM security_private.added_indexes WHERE migration = '20261020000900_m4';
  END IF;
END $$;
