-- One instructor identity per split cohort/course component.
--
-- A cohort may be divided into two or more delivery groups for capacity, but
-- that operational split must not divide academic responsibility. All theory
-- groups use one university faculty identity, and all practical groups use one
-- university faculty identity. Theory and practical may use different people.
BEGIN;

INSERT INTO public.constraint_types(
  code, name_ar, name_en, constraint_category, is_hard, default_weight, description
) VALUES (
  'cohort_component_single_instructor',
  'محاضر موحّد لمجموعات مكوّن الدفعة',
  'One instructor per split cohort component',
  'hard', true, 100,
  'عند تقسيم دفعة إلى مجموعتين أو أكثر للمقرر نفسه، يدرّس محاضر واحد جميع مجموعات النظري ومحاضر واحد جميع مجموعات العملي'
)
ON CONFLICT (code) DO NOTHING;

-- Internal write guard. Identity, rather than the college-local instructor row,
-- is compared so verified aliases of the same person are not false conflicts.
CREATE OR REPLACE FUNCTION faculty_private.assert_cohort_component_single_instructor(
  p_delivery_group_id uuid,
  p_instructor_id uuid,
  p_exclude_assignment_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cohort_id uuid;
  v_plan_course_id uuid;
  v_component_type text;
  v_identity_id uuid;
  v_group_count integer := 0;
  v_peer_names text[] := ARRAY[]::text[];
BEGIN
  IF p_delivery_group_id IS NULL OR p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  SELECT dg.cohort_id, dg.plan_course_id, pcc.component_type, fil.identity_id
    INTO v_cohort_id, v_plan_course_id, v_component_type, v_identity_id
  FROM public.delivery_groups dg
  JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
  LEFT JOIN public.faculty_identity_links fil ON fil.instructor_id = p_instructor_id
  WHERE dg.id = p_delivery_group_id;

  IF v_cohort_id IS NULL OR v_plan_course_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF v_component_type NOT IN ('theory', 'practical') THEN
    RETURN;
  END IF;
  IF v_identity_id IS NULL THEN
    RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_group_count
  FROM public.delivery_groups peer_group
  JOIN public.plan_course_components peer_component
    ON peer_component.id = peer_group.component_id
  WHERE peer_group.cohort_id = v_cohort_id
    AND peer_group.plan_course_id = v_plan_course_id
    AND peer_component.component_type = v_component_type
    AND peer_group.active = true
    AND NOT coalesce(peer_group.is_obsolete, false);

  -- The rule is specifically for a cohort component split into 2+ groups.
  IF v_group_count < 2 THEN
    RETURN;
  END IF;

  -- Serialise all assignment writes for this academic key. Without this lock,
  -- concurrent inserts into different groups could both observe no peer row.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_cohort_id::text || '|' || v_plan_course_id::text || '|' || v_component_type,
    20260928
  ));

  SELECT coalesce(array_agg(DISTINCT coalesce(i.full_name, 'هوية غير مكتملة')
                            ORDER BY coalesce(i.full_name, 'هوية غير مكتملة')),
                  ARRAY[]::text[])
    INTO v_peer_names
  FROM public.teaching_assignments ta
  JOIN public.delivery_groups peer_group ON peer_group.id = ta.delivery_group_id
  JOIN public.plan_course_components peer_component
    ON peer_component.id = peer_group.component_id
  LEFT JOIN public.faculty_identity_links peer_link
    ON peer_link.instructor_id = ta.instructor_id
  LEFT JOIN public.instructors i ON i.id = ta.instructor_id
  WHERE ta.is_active = true
    AND ta.id IS DISTINCT FROM p_exclude_assignment_id
    AND peer_group.active = true
    AND NOT coalesce(peer_group.is_obsolete, false)
    AND peer_group.cohort_id = v_cohort_id
    AND peer_group.plan_course_id = v_plan_course_id
    AND peer_component.component_type = v_component_type
    AND (peer_link.identity_id IS NULL OR peer_link.identity_id IS DISTINCT FROM v_identity_id);

  IF cardinality(v_peer_names) > 0 THEN
    RAISE EXCEPTION 'COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED'
      USING ERRCODE = '23514',
        DETAIL = format(
          'cohort=%s plan_course=%s component=%s groups=%s existing_instructors=%s',
          v_cohort_id, v_plan_course_id, v_component_type, v_group_count,
          array_to_string(v_peer_names, '، ')
        );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION faculty_private.assert_cohort_component_single_instructor(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION faculty_private.guard_cohort_component_single_instructor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT coalesce(NEW.is_active, true) OR NEW.delivery_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND coalesce(OLD.is_active, true)
     AND NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id
     AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id THEN
    RETURN NEW;
  END IF;

  PERFORM faculty_private.assert_cohort_component_single_instructor(
    NEW.delivery_group_id,
    NEW.instructor_id,
    NEW.id
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION faculty_private.guard_cohort_component_single_instructor()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_guard_cohort_component_single_instructor
  ON public.teaching_assignments;
CREATE TRIGGER zzz_guard_cohort_component_single_instructor
  BEFORE INSERT OR UPDATE OF instructor_id, delivery_group_id, is_active
  ON public.teaching_assignments
  FOR EACH ROW
  EXECUTE FUNCTION faculty_private.guard_cohort_component_single_instructor();

-- Read-only readiness used by the generator and the conflict-check screen.
-- It reports existing legacy inconsistencies; it never rewrites assignments.
CREATE OR REPLACE FUNCTION public.get_cohort_component_instructor_readiness(
  p_college_id uuid,
  p_schedule_version_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_term_id uuid;
  v_violations jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF p_schedule_version_id IS NOT NULL THEN
    SELECT sv.academic_term_id INTO v_term_id
    FROM public.schedule_versions sv
    WHERE sv.id = p_schedule_version_id AND sv.college_id = p_college_id;
    IF v_term_id IS NULL THEN
      RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  WITH scoped AS (
    SELECT
      dg.cohort_id,
      dg.plan_course_id,
      pcc.component_type,
      dg.id AS delivery_group_id,
      ta.id AS assignment_id,
      ta.instructor_id,
      fil.identity_id,
      ac.code AS cohort_code,
      crs.code AS course_code,
      crs.name AS course_name,
      i.full_name AS instructor_name
    FROM public.delivery_groups dg
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses crs ON crs.id = pc.course_id
    LEFT JOIN public.teaching_assignments ta
      ON ta.delivery_group_id = dg.id AND ta.is_active = true
    LEFT JOIN public.faculty_identity_links fil ON fil.instructor_id = ta.instructor_id
    LEFT JOIN public.instructors i ON i.id = ta.instructor_id
    WHERE dg.college_id = p_college_id
      AND dg.active = true
      AND NOT coalesce(dg.is_obsolete, false)
      AND pcc.component_type IN ('theory', 'practical')
      AND (v_term_id IS NULL OR ac.term_id = v_term_id)
  ), violations AS (
    SELECT
      cohort_id,
      plan_course_id,
      component_type,
      min(cohort_code) AS cohort_code,
      min(course_code) AS course_code,
      min(course_name) AS course_name,
      count(DISTINCT delivery_group_id)::integer AS group_count,
      count(DISTINCT identity_id)::integer AS instructor_count,
      count(assignment_id) FILTER (
        WHERE assignment_id IS NOT NULL AND identity_id IS NULL
      )::integer AS identity_missing_count,
      array_agg(DISTINCT coalesce(instructor_name, 'هوية غير مكتملة')
                ORDER BY coalesce(instructor_name, 'هوية غير مكتملة'))
        FILTER (WHERE assignment_id IS NOT NULL) AS instructor_names,
      array_agg(DISTINCT assignment_id ORDER BY assignment_id)
        FILTER (WHERE assignment_id IS NOT NULL) AS assignment_ids
    FROM scoped
    GROUP BY cohort_id, plan_course_id, component_type
    HAVING count(DISTINCT delivery_group_id) >= 2
       AND (
         count(DISTINCT identity_id) > 1
         OR count(assignment_id) FILTER (
           WHERE assignment_id IS NOT NULL AND identity_id IS NULL
         ) > 0
       )
  )
  SELECT
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'cohort_id', cohort_id,
      'cohort_code', cohort_code,
      'plan_course_id', plan_course_id,
      'course_code', course_code,
      'course_name', course_name,
      'component_type', component_type,
      'group_count', group_count,
      'instructor_count', instructor_count,
      'identity_missing_count', identity_missing_count,
      'instructor_names', to_jsonb(coalesce(instructor_names, ARRAY[]::text[])),
      'assignment_ids', to_jsonb(coalesce(assignment_ids, ARRAY[]::uuid[]))
    ) ORDER BY cohort_code, course_code, component_type), '[]'::jsonb)
  INTO v_count, v_violations
  FROM violations;

  RETURN jsonb_build_object(
    'ok', v_count = 0,
    'college_id', p_college_id,
    'schedule_version_id', p_schedule_version_id,
    'academic_term_id', v_term_id,
    'violation_count', v_count,
    'violations', v_violations
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cohort_component_instructor_readiness(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cohort_component_instructor_readiness(uuid,uuid)
  TO authenticated, service_role;

-- Server-authoritative conflict for create, move, relayout and publish-quality
-- checks. Existing inconsistent assignments therefore cannot silently produce
-- or legitimise timetable sessions.
CREATE OR REPLACE FUNCTION public._ss_cohort_component_instructor(
  p_session_id uuid,
  p_teaching_assignment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cohort_id uuid;
  v_plan_course_id uuid;
  v_component_type text;
  v_group_count integer := 0;
  v_instructor_count integer := 0;
  v_identity_missing integer := 0;
BEGIN
  IF p_teaching_assignment_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT dg.cohort_id, dg.plan_course_id, pcc.component_type
    INTO v_cohort_id, v_plan_course_id, v_component_type
  FROM public.teaching_assignments ta
  JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
  JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
  WHERE ta.id = p_teaching_assignment_id AND ta.is_active = true;

  IF v_component_type NOT IN ('theory', 'practical') THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT
    count(DISTINCT dg.id)::integer,
    count(DISTINCT fil.identity_id)::integer,
    count(ta.id) FILTER (WHERE ta.id IS NOT NULL AND fil.identity_id IS NULL)::integer
  INTO v_group_count, v_instructor_count, v_identity_missing
  FROM public.delivery_groups dg
  JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
  LEFT JOIN public.teaching_assignments ta
    ON ta.delivery_group_id = dg.id AND ta.is_active = true
  LEFT JOIN public.faculty_identity_links fil ON fil.instructor_id = ta.instructor_id
  WHERE dg.cohort_id = v_cohort_id
    AND dg.plan_course_id = v_plan_course_id
    AND pcc.component_type = v_component_type
    AND dg.active = true
    AND NOT coalesce(dg.is_obsolete, false);

  IF v_group_count >= 2
     AND (v_instructor_count > 1 OR v_identity_missing > 0) THEN
    RETURN jsonb_build_array(public._ss_ci(
      'cohort_component_single_instructor', 'hard', p_session_id, NULL,
      jsonb_build_object(
        'cohort_id', v_cohort_id,
        'plan_course_id', v_plan_course_id,
        'component_type', v_component_type,
        'group_count', v_group_count,
        'instructor_count', v_instructor_count,
        'identity_missing_count', v_identity_missing
      )
    ));
  END IF;
  RETURN '[]'::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public._ss_cohort_component_instructor(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Preserve the complete collector introduced by 20260928010000 and add the
-- new fixed rule. Argument g is teaching_assignment_id.
CREATE OR REPLACE FUNCTION public._ss_gather(
  a uuid, b uuid, c uuid, d uuid, e uuid, f uuid, g uuid,
  h text, i integer, j integer, k time without time zone,
  l time without time zone, m uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT COALESCE(public._ss_peer_i(a,b,c,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_r(a,b,c,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_s(a,b,c,e,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_room_cap(a,b,f,i,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_type(a,b,g,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_av(a,b,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_req(a,b,d,j),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_win(a,b,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_instructor_daily_hours(a,b,c,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_instructor_attendance_days(a,b,c,d,j),'[]'::jsonb)
 ||COALESCE(public._ss_student_daily_hours(a,b,c,e,g,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_student_extended_days(a,b,c,e,g,j,l),'[]'::jsonb)
 ||COALESCE(public._ss_tmpl(a,b,h,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_set(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_brk(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_itcs_theory_hours(a,b,g,l),'[]'::jsonb)
 ||COALESCE(public._ss_cohort_component_instructor(a,g),'[]'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public._ss_gather(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,
  time without time zone,time without time zone,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_gather(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,
  time without time zone,time without time zone,uuid
) TO service_role;

-- This institutional equality rule is fixed and cannot be converted to an
-- approved exception.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.schedule_version_conflict_exceptions'::regclass
      AND conname = 'svce_no_cohort_component_instructor'
  ) THEN
    ALTER TABLE public.schedule_version_conflict_exceptions
      ADD CONSTRAINT svce_no_cohort_component_instructor
      CHECK (conflict_code <> 'cohort_component_single_instructor');
  END IF;
END
$guard$;

COMMENT ON FUNCTION public.get_cohort_component_instructor_readiness(uuid,uuid) IS
  'Read-only hard-rule readiness: split theory/practical groups of one cohort/course component must share one faculty identity.';

NOTIFY pgrst, 'reload schema';
COMMIT;
