-- M-5: required foreign keys exist with the intended ON DELETE semantics, and
-- purge_all_academic_operational_data rejects callers that are not the
-- service role / owner session even if EXECUTE were granted.
BEGIN;
DO $$
DECLARE
  r record; v_act "char"; v_list text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('schedule_sessions','instructor_id','instructors','r'),
    ('schedule_sessions','teaching_assignment_id','teaching_assignments','r'),
    ('schedule_sessions','section_id','sections','r'),
    ('teaching_assignments','instructor_id','instructors','r'),
    ('instructors','college_id','colleges','r'),
    ('instructors','department_id','departments','n'),
    ('rooms','college_id','colleges','r'),
    ('rooms','room_type_id','room_types','r'),
    ('course_offerings','college_id','colleges','r'),
    ('course_offerings','course_id','courses','r'),
    ('course_offerings','plan_course_id','plan_courses','r'),
    ('course_offerings','study_plan_id','study_plans','r'),
    ('schedule_quality_runs','schedule_version_id','schedule_versions','c'),
    ('instructor_types','college_id','colleges','c'),
    ('conflict_results','schedule_session_id','schedule_sessions','c')
  ) t(tbl, col, ref, act) LOOP
    SELECT k.confdeltype INTO v_act
      FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
     WHERE k.contype = 'f' AND k.conrelid = ('public.' || r.tbl)::regclass
       AND a.attname = r.col AND k.confrelid = ('public.' || r.ref)::regclass
     LIMIT 1;
    IF v_act IS NULL THEN
      RAISE EXCEPTION 'M-5: missing FK %.% -> %', r.tbl, r.col, r.ref;
    END IF;
    IF v_act <> r.act::"char" AND NOT (r.act = 'r' AND v_act = 'a') THEN
      RAISE EXCEPTION 'M-5: FK %.% has ON DELETE % (expected %)', r.tbl, r.col, v_act, r.act;
    END IF;
  END LOOP;

  -- every public table with a college_id column references colleges
  PERFORM 1;
  SELECT string_agg(c.relname, ', ') INTO v_list FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'college_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                       AND a.attnum = ANY (k.conkey));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'M-5: tables with unconstrained college_id: %', v_list;
  END IF;
END $$;

-- behavioural: an instructor referenced by an assignment cannot be deleted
SET LOCAL session_replication_role = replica;
INSERT INTO public.colleges (id, university_id, name) VALUES ('0000000e-0000-0000-0000-0000000000c1', gen_random_uuid(), 'M5');
INSERT INTO public.instructors (id, college_id, full_name) VALUES ('0000000e-0000-0000-0000-0000000000a1', '0000000e-0000-0000-0000-0000000000c1', 'I');
INSERT INTO public.teaching_assignments (id, college_id, course_offering_id, instructor_id, is_active)
VALUES ('0000000e-0000-0000-0000-0000000000b1', '0000000e-0000-0000-0000-0000000000c1', gen_random_uuid(), '0000000e-0000-0000-0000-0000000000a1', false);
SET LOCAL session_replication_role = origin;
DO $$
BEGIN
  BEGIN
    DELETE FROM public.instructors WHERE id = '0000000e-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'M-5: instructor with assignment history deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- purge: authenticated caller with an explicit grant is still refused
GRANT EXECUTE ON FUNCTION public.purge_all_academic_operational_data() TO authenticated;
-- emulate PostgREST: session_user is not the owner (psql runs as postgres)
SET SESSION AUTHORIZATION authenticated;
SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
BEGIN
  PERFORM public.purge_all_academic_operational_data();
  RAISE EXCEPTION 'M-5: purge accepted an authenticated caller';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM <> 'PURGE_MAINTENANCE_ROLE_REQUIRED' THEN RAISE; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
