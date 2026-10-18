-- M-4 (performance):
--  1. Index every foreign key whose column set has no index with the same
--     leading columns (public and *_private schemas), and index college_id on
--     every public table that has it. Plain CREATE INDEX (migrations run inside
--     a transaction; tables are small). Names carry a hash suffix to avoid
--     collisions; IF NOT EXISTS keeps re-runs idempotent.
--  2. Rewrite RLS policies in public so auth.uid() is evaluated once per
--     statement (InitPlan) instead of once per row: auth.uid() ->
--     (SELECT auth.uid()). The expression is otherwise unchanged; the migration
--     verifies that un-wrapping the new text yields exactly the old text.

CREATE SCHEMA IF NOT EXISTS security_private;
CREATE TABLE IF NOT EXISTS security_private.added_indexes (
  migration text NOT NULL,
  index_name text NOT NULL,
  schema_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schema_name, index_name)
);
REVOKE ALL ON security_private.added_indexes FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS security_private.policy_rewrites (
  migration text NOT NULL,
  table_name text NOT NULL,
  policy_name text NOT NULL,
  old_qual text,
  old_with_check text,
  PRIMARY KEY (table_name, policy_name)
);
REVOKE ALL ON security_private.policy_rewrites FROM PUBLIC, anon, authenticated;

-- 1. Indexes --------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_name text;
  v_cols text;
BEGIN
  FOR r IN
    -- FK column sets without a leading-column index
    SELECT DISTINCT k.conrelid, n.nspname, c.relname, k.conkey AS cols
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE k.contype = 'f'
       AND c.relkind = 'r'
       AND (n.nspname = 'public' OR n.nspname LIKE '%\_private')
       AND NOT EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = k.conrelid
            AND i.indpred IS NULL
            AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] @> k.conkey
            AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] <@ k.conkey)
    UNION
    -- college_id on every public table
    SELECT c.oid, n.nspname, c.relname, ARRAY[a.attnum]::int2[]
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'college_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (SELECT 1 FROM pg_index i
                        WHERE i.indrelid = c.oid AND i.indpred IS NULL
                          AND (i.indkey::int2[])[0] = a.attnum)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord),
           string_agg(a.attname, '_' ORDER BY u.ord)
      INTO v_cols, v_name
      FROM unnest(r.cols) WITH ORDINALITY u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = u.attnum;
    v_name := left(r.relname || '_' || v_name, 48) || '_ix_'
              || substr(md5(r.nspname || '.' || r.relname || '(' || v_cols || ')'), 1, 8);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)', v_name, r.nspname, r.relname, v_cols);
    INSERT INTO security_private.added_indexes (migration, index_name, schema_name)
    VALUES ('20261020000900_m4', v_name, r.nspname) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 2. RLS policies: auth.uid() -> (SELECT auth.uid()) ------------------------
DO $$
DECLARE
  r record;
  v_wrapped constant text := '( SELECT auth.uid() AS uid)';
  v_mark constant text := '__AUTH_UID_INITPLAN__';
  v_q text; v_c text; v_sql text;
  n_q text; n_c text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (replace(coalesce(qual, ''), v_wrapped, '') LIKE '%auth.uid()%'
         OR replace(coalesce(with_check, ''), v_wrapped, '') LIKE '%auth.uid()%')
  LOOP
    v_q := replace(replace(replace(r.qual, v_wrapped, v_mark), 'auth.uid()', '(SELECT auth.uid())'), v_mark, v_wrapped);
    v_c := replace(replace(replace(r.with_check, v_wrapped, v_mark), 'auth.uid()', '(SELECT auth.uid())'), v_mark, v_wrapped);
    v_sql := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF v_q IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_q || ')'; END IF;
    IF v_c IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_c || ')'; END IF;
    INSERT INTO security_private.policy_rewrites (migration, table_name, policy_name, old_qual, old_with_check)
    VALUES ('20261020000900_m4', r.tablename, r.policyname, r.qual, r.with_check)
    ON CONFLICT (table_name, policy_name) DO NOTHING;
    EXECUTE v_sql;

    -- verify: the re-deparsed policy differs from the original only by the wrap
    SELECT replace(p.qual, v_wrapped, 'auth.uid()'), replace(p.with_check, v_wrapped, 'auth.uid()')
      INTO n_q, n_c
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = r.tablename AND p.policyname = r.policyname;
    IF n_q IS DISTINCT FROM replace(r.qual, v_wrapped, 'auth.uid()')
       OR n_c IS DISTINCT FROM replace(r.with_check, v_wrapped, 'auth.uid()') THEN
      RAISE EXCEPTION 'M-4: policy % on % changed semantics: % / %', r.policyname, r.tablename, n_q, n_c;
    END IF;
  END LOOP;
END $$;
