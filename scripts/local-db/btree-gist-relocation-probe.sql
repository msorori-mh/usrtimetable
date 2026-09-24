-- LAUNCH-CLOSURE-SECURITY — runtime probe for relocating btree_gist out of `public`.
-- Runs ONLY on the disposable proof cluster. Never against the project database.
--
-- Question: does `ALTER EXTENSION btree_gist SET SCHEMA extensions` keep the existing GiST
-- exclusion constraints working, and does adding a NEW one still work afterwards?
\set ON_ERROR_STOP on

DO $probe$
DECLARE
  v_excl_before int;
  v_excl_after int;
  v_new_ok boolean := false;
  v_new_err text;
BEGIN
  SELECT count(*) INTO v_excl_before FROM pg_constraint
  WHERE conname IN ('instructor_availability_no_overlap', 'room_unavailability_no_overlap');

  CREATE SCHEMA IF NOT EXISTS extensions;
  ALTER EXTENSION btree_gist SET SCHEMA extensions;

  -- Stored opclass references are by OID, so existing constraints must be untouched.
  SELECT count(*) INTO v_excl_after FROM pg_constraint
  WHERE conname IN ('instructor_availability_no_overlap', 'room_unavailability_no_overlap');

  IF v_excl_after <> v_excl_before THEN
    RAISE EXCEPTION 'PROBE: relocation dropped an exclusion constraint (% -> %)',
      v_excl_before, v_excl_after;
  END IF;

  -- Existing constraint must still ENFORCE, not merely exist. Proven by the behaviour
  -- cases that run after this probe.

  -- Now the forward-compatibility question: can a LATER migration still add a GiST
  -- exclusion constraint that needs a btree_gist opclass, with the default search_path?
  BEGIN
    CREATE TABLE public._probe_relocate (
      college_id uuid NOT NULL,
      span tsrange NOT NULL
    );
    EXECUTE $ddl$
      ALTER TABLE public._probe_relocate
        ADD CONSTRAINT _probe_relocate_excl
        EXCLUDE USING gist (college_id WITH =, span WITH &&)
    $ddl$;
    v_new_ok := true;
  EXCEPTION WHEN others THEN
    v_new_err := SQLERRM;
  END;

  RAISE NOTICE 'PROBE relocation: existing_constraints_preserved=% new_ddl_ok=% new_ddl_err=%',
    (v_excl_after = v_excl_before), v_new_ok, coalesce(v_new_err, 'none');

  -- Reverse the relocation so the rest of the suite runs against the production layout.
  ALTER EXTENSION btree_gist SET SCHEMA public;
  DROP TABLE IF EXISTS public._probe_relocate;

  RAISE NOTICE 'PROBE relocation: reverted to public, extension schema now %',
    (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'btree_gist');
END
$probe$;
