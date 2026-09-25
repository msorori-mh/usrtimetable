-- Stage ITCS-ISO-02e: route existing V2 server writes and work items through
-- the selected-version guards. The exact live function bodies are checked
-- before replacement; an unexpected upstream change aborts the transaction.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $patch$
DECLARE d text; signature regprocedure;
BEGIN
  signature:='public.ensure_ss_college()'::regprocedure;
  d:=pg_get_functiondef(signature);
  IF position('FROM public.operational_delivery_groups dg' in d)=0
     OR position('NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students' in d)=0 THEN
    RAISE EXCEPTION 'VERSION_GUARD_ENSURE_SCOPE_CHANGED';
  END IF;
  IF position('FROM public.operational_delivery_groups dg'||chr(10)||'      WHERE dg.id = ta_dg;' in d)=0
     OR position('FROM public.operational_delivery_groups dg'||chr(10)||'    WHERE dg.id = NEW.delivery_group_id;' in d)=0 THEN
    RAISE EXCEPTION 'VERSION_GUARD_ENSURE_LOOKUP_CHANGED';
  END IF;
  d:=replace(d,
    'FROM public.operational_delivery_groups dg'||chr(10)||'      WHERE dg.id = ta_dg;',
    'FROM public.operational_delivery_group(NEW.schedule_version_id,ta_dg) dg'||chr(10)||'      WHERE dg.id = ta_dg;');
  d:=replace(d,
    'FROM public.operational_delivery_groups dg'||chr(10)||'    WHERE dg.id = NEW.delivery_group_id;',
    'FROM public.operational_delivery_group(NEW.schedule_version_id,NEW.delivery_group_id) dg'||chr(10)||'    WHERE dg.id = NEW.delivery_group_id;');
  d:=replace(d,
    '(public.operational_delivery_group(NEW.delivery_group_id)).expected_students',
    '(public.operational_delivery_group(NEW.schedule_version_id,NEW.delivery_group_id)).expected_students');
  EXECUTE d;

  signature:='public.create_schedule_session_from_assignment_v2(uuid,uuid,integer,time,time,uuid,timestamptz,text)'::regprocedure;
  d:=pg_get_functiondef(signature);
  IF position('v_guard := public._sb_v2_assignment_guard(v_ta.id);' in d)=0
     OR position('v_dg := public.operational_delivery_group(v_dg.id);' in d)=0 THEN
    RAISE EXCEPTION 'VERSION_GUARD_CREATE_SCOPE_CHANGED';
  END IF;
  d:=replace(d,'v_guard := public._sb_v2_assignment_guard(v_ta.id);',
    'v_guard := public._sb_v2_assignment_guard(v_ta.id,p_schedule_version_id);');
  d:=replace(d,'v_dg := public.operational_delivery_group(v_dg.id);',
    E'v_dg := public.operational_delivery_group(p_schedule_version_id,v_dg.id);\n  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s\n    WHERE s.version_id=p_schedule_version_id AND s.cohort_id=v_dg.cohort_id) THEN\n    v_ta.expected_students:=v_dg.expected_students;\n  END IF;');
  EXECUTE d;

  signature:='public.apply_schedule_relayout(uuid,uuid,uuid,bigint,timestamptz,jsonb,integer)'::regprocedure;
  d:=pg_get_functiondef(signature);
  IF position('v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);' in d)=0 THEN
    RAISE EXCEPTION 'VERSION_GUARD_RELAYOUT_SCOPE_CHANGED';
  END IF;
  d:=replace(d,'v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);',
    'v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id,p_version_id);');
  EXECUTE d;

  signature:='public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure;
  d:=pg_get_functiondef(signature);
  IF position('JOIN public.operational_delivery_groups dg' in d)=0
     OR position('SELECT public.delivery_group_is_current(dg.id) AS is_current' in d)=0
     OR position('COALESCE(ta.expected_students, dg.expected_students, 0)' in d)=0 THEN
    RAISE EXCEPTION 'VERSION_GUARD_WORK_ITEM_SCOPE_CHANGED';
  END IF;
  d:=replace(d,'JOIN public.operational_delivery_groups dg',
    'JOIN public.operational_delivery_group(p_schedule_version_id,ta.delivery_group_id) dg');
  d:=replace(d,'SELECT public.delivery_group_is_current(dg.id) AS is_current',
    'SELECT public.delivery_group_is_current(dg.id,p_schedule_version_id) AS is_current');
  d:=replace(d,'COALESCE(ta.expected_students, dg.expected_students, 0)',
    E'CASE WHEN EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s\n          WHERE s.version_id=p_schedule_version_id AND s.cohort_id=dg.cohort_id)\n        THEN dg.expected_students ELSE COALESCE(ta.expected_students,dg.expected_students,0) END');
  -- Newly added draft groups have no fact in V2, so they are invisible there.
  d:=replace(d,'ON dg.id = ta.delivery_group_id',
    E'ON dg.id = ta.delivery_group_id\n     AND (NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s\n       WHERE s.version_id=p_schedule_version_id AND s.cohort_id=dg.cohort_id)\n       OR EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts f\n       WHERE f.version_id=p_schedule_version_id AND f.group_id=dg.id))');
  EXECUTE d;
END
$patch$;

COMMENT ON FUNCTION public.delivery_group_derivation_status(uuid,uuid)
IS 'Checks group freshness against the selected schedule version; unscoped cohorts use the legacy guard.';
COMMIT;
