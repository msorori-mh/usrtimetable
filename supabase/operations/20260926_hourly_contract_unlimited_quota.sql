-- Hourly contract staff (type code con) have no fixed weekly teaching quota.
-- The home-college approval and assignment-identity guards remain active.
-- One-shot production operation; precondition pins the existing function body.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(9262, 20260926);
DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.enforce_instructor_extra_hours_limit()'::regprocedure))
     <> '2571e60a279889f55005cfeda1e782e2' THEN
    RAISE EXCEPTION 'HOURLY_CONTRACT_GUARD_SOURCE_CHANGED';
  END IF;
  IF (SELECT count(*) FROM public.instructors i
      JOIN public.instructor_types t ON t.id=i.instructor_type_id
      WHERE i.id IN ('5fca9916-06d6-486a-9d14-80361c5af003',
                     'c7e30271-c69e-43e5-b7f2-1e51217e6b4b')
        AND i.employment_type='contract' AND t.code='con'
        AND faculty_private.quota_applicability(t.code,i.employment_type) IS FALSE) <> 2 THEN
    RAISE EXCEPTION 'HOURLY_CONTRACT_CLASSIFICATION_CHANGED';
  END IF;
END $pre$;
CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_term uuid; v_load jsonb; v_quota numeric; v_waived boolean;
BEGIN
  IF NOT coalesce(NEW.is_active,false) THEN RETURN NEW; END IF;
  SELECT term_id INTO v_term FROM public.course_offerings WHERE id=NEW.course_offering_id;
  IF public.existing_schedule_intake_enabled(NEW.college_id,v_term) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(180600,1);
  v_load:=faculty_private.workload(NEW.instructor_id,v_term);
  v_quota:=(v_load->>'required_load_hours')::numeric;
  SELECT EXISTS (
    SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
    JOIN public.schedule_versions v ON v.id=w.version_id
    JOIN public.delivery_groups g ON g.id=w.group_id
    WHERE w.assignment_id=NEW.id AND w.instructor_id=NEW.instructor_id
      AND w.college_id=NEW.college_id AND w.term_id=v_term
      AND w.group_id=NEW.delivery_group_id
      AND v.status='draft' AND v.college_id=w.college_id
      AND v.academic_term_id=w.term_id
      AND g.cohort_id=NEW.cohort_id
      AND EXISTS (
        SELECT 1 FROM public.teaching_assignments src
        WHERE src.id=w.source_assignment_id AND src.instructor_id=NEW.instructor_id
          AND src.course_offering_id=NEW.course_offering_id
          AND src.plan_course_component_id=NEW.plan_course_component_id
      )
  ) INTO v_waived;
  -- The exact published-source clone also covers a missing institutional
  -- quota rule; no rank or home-college value is fabricated for a lecturer.
  IF (v_load->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'FACULTY_ALLOCATION_REVIEW_REQUIRED' USING ERRCODE='23514';
  END IF;
  -- Hourly contracts are paid per teaching hour and have no fixed quota.
  IF (v_load->>'quota_applicable')::boolean IS FALSE AND EXISTS (
    SELECT 1 FROM public.instructors i
    JOIN public.instructor_types t ON t.id=i.instructor_type_id
    WHERE i.id=NEW.instructor_id AND i.employment_type='contract' AND t.code='con'
  ) THEN RETURN NEW; END IF;
  IF v_quota IS NULL AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب اعتماد النصاب من الكلية الأصلية' USING ERRCODE='23514';
  END IF;
  IF (v_load->>'standard_assigned_hours')::numeric>v_quota+12 AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$
;
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.enforce_instructor_extra_hours_limit()'::regprocedure))
     <> 'a42c36e17e427362b8d6fc615cd7f857' THEN
    RAISE EXCEPTION 'HOURLY_CONTRACT_GUARD_POSTCHECK_FAILED';
  END IF;
END $post$;
COMMIT;
