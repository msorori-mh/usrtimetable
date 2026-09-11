-- ---------------------------------------------------------------------------
-- Idempotent state pin for USR07 / CS111 only (course, plan pattern, components).
-- Function and view definitions for the weekly-vs-supervision project split are
-- pinned in 20260911214530_a6ae073b-3882-417f-8b63-b0a6631c2e2d.sql; this file
-- pins the resulting data state and verifies the split is still in place.
-- Weekly project = counts_toward_regular_load true; graduation projects keep
-- counts_toward_regular_load = false and stay supervision-only, never weekly.
-- ---------------------------------------------------------------------------

UPDATE public.courses
SET credit_hours = 4, theory_hours = 2, practical_hours = 0
WHERE code IN ('USR07','CS111')
  AND (credit_hours <> 4 OR theory_hours <> 2 OR practical_hours <> 0);

-- Existing practical/tutorial rows become the weekly project component in place
-- (same component id, so delivery groups and assignments keep their links).
UPDATE public.plan_course_components pcc
SET component_type = 'project'
WHERE pcc.plan_course_id IN (
    SELECT pc.id FROM public.plan_courses pc
    JOIN public.courses c ON c.id = pc.course_id
    WHERE c.code IN ('USR07','CS111'))
  AND pcc.component_type IN ('practical','tutorial')
  AND NOT EXISTS (
    SELECT 1 FROM public.plan_course_components p2
    WHERE p2.plan_course_id = pcc.plan_course_id AND p2.component_type = 'project');

DELETE FROM public.plan_course_components pcc
WHERE pcc.plan_course_id IN (
    SELECT pc.id FROM public.plan_courses pc
    JOIN public.courses c ON c.id = pc.course_id
    WHERE c.code IN ('USR07','CS111'))
  AND pcc.component_type IN ('practical','tutorial');

INSERT INTO public.plan_course_components (
  college_id, plan_course_id, component_type, weekly_contact_hours, required_room_type_id,
  is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode)
SELECT pc.college_id, pc.id, t.k, 2, rt.id, true, true, true, 'per_hour'
FROM public.plan_courses pc
JOIN public.courses c ON c.id = pc.course_id
JOIN public.room_types rt ON rt.college_id = pc.college_id AND rt.code = 'lecture_hall'
CROSS JOIN (VALUES ('theory'),('project')) t(k)
WHERE c.code IN ('USR07','CS111')
ON CONFLICT (plan_course_id, component_type) DO NOTHING;

UPDATE public.plan_course_components pcc
SET weekly_contact_hours = 2,
    required_room_type_id = rt.id,
    is_timetabled = true,
    counts_toward_regular_load = true,
    counts_toward_overtime = true,
    compensation_mode = 'per_hour',
    explicit_group_size = NULL
FROM public.plan_courses pc
JOIN public.courses c ON c.id = pc.course_id
JOIN public.room_types rt ON rt.college_id = pc.college_id AND rt.code = 'lecture_hall'
WHERE pc.id = pcc.plan_course_id
  AND c.code IN ('USR07','CS111')
  AND pcc.component_type IN ('theory','project')
  AND (pcc.weekly_contact_hours <> 2
    OR pcc.required_room_type_id IS DISTINCT FROM rt.id
    OR pcc.is_timetabled IS DISTINCT FROM true
    OR pcc.counts_toward_regular_load IS DISTINCT FROM true
    OR pcc.counts_toward_overtime IS DISTINCT FROM true
    OR pcc.compensation_mode IS DISTINCT FROM 'per_hour'
    OR pcc.explicit_group_size IS NOT NULL);

UPDATE public.plan_courses pc
SET lecture_session_duration = 2,
    lab_session_duration = 2,
    lectures_per_week = 2,
    labs_per_week = 0,
    required_room_type_for_lecture = 'lecture_hall',
    required_room_type_for_lab = NULL
FROM public.courses c
WHERE c.id = pc.course_id
  AND c.code IN ('USR07','CS111')
  AND (pc.lecture_session_duration <> 2
    OR pc.lab_session_duration <> 2
    OR pc.lectures_per_week <> 2
    OR pc.labs_per_week <> 0
    OR pc.required_room_type_for_lecture IS DISTINCT FROM 'lecture_hall'
    OR pc.required_room_type_for_lab IS NOT NULL);

-- Deactivate (never delete) active assignments on obsolete target groups that carry
-- no scheduled sessions. Runs before the assignment field alignment so the
-- obsolete-group guard on teaching_assignments accepts the remaining updates.
UPDATE public.teaching_assignments ta
SET is_active = false
FROM public.delivery_groups dg
JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
JOIN public.courses c ON c.id = pc.course_id
WHERE ta.delivery_group_id = dg.id
  AND c.code IN ('USR07','CS111')
  AND COALESCE(dg.is_obsolete, false)
  AND COALESCE(ta.is_active, true)
  AND NOT EXISTS (
    SELECT 1 FROM public.schedule_sessions ss WHERE ss.teaching_assignment_id = ta.id);

UPDATE public.teaching_assignments ta
SET session_type = CASE WHEN pcc.component_type = 'theory' THEN 'lecture' ELSE 'seminar' END,
    required_room_type = 'lecture_hall',
    weekly_hours = 2,
    assigned_component_hours = CASE WHEN ta.assigned_component_hours IS NOT NULL THEN 2 ELSE NULL END,
    plan_course_component_id = dg.component_id
FROM public.delivery_groups dg
JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
JOIN public.courses c ON c.id = pc.course_id
WHERE ta.delivery_group_id = dg.id
  AND c.code IN ('USR07','CS111')
  AND (ta.session_type IS DISTINCT FROM (CASE WHEN pcc.component_type = 'theory' THEN 'lecture' ELSE 'seminar' END)
    OR ta.required_room_type IS DISTINCT FROM 'lecture_hall'
    OR ta.weekly_hours IS DISTINCT FROM 2
    OR ta.plan_course_component_id IS DISTINCT FROM dg.component_id
    OR (ta.assigned_component_hours IS NOT NULL AND ta.assigned_component_hours <> 2));

-- Self-verification: the pinned state must hold for both courses, and graduation
-- projects elsewhere must stay non-weekly supervision components.
DO $verify$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.plan_courses pc
  JOIN public.courses c ON c.id = pc.course_id
  WHERE c.code IN ('USR07','CS111')
    AND (
      pc.lectures_per_week <> 2 OR pc.labs_per_week <> 0
      OR pc.lecture_session_duration <> 2
      OR pc.required_room_type_for_lecture IS DISTINCT FROM 'lecture_hall'
      OR (SELECT count(*) FROM public.plan_course_components x
            WHERE x.plan_course_id = pc.id) <> 2
      OR EXISTS (SELECT 1 FROM public.plan_course_components x
            WHERE x.plan_course_id = pc.id AND x.component_type IN ('practical','tutorial'))
      OR EXISTS (SELECT 1 FROM public.plan_course_components x
            WHERE x.plan_course_id = pc.id
              AND (x.weekly_contact_hours <> 2
                OR COALESCE(x.counts_toward_regular_load, false) = false
                OR x.is_timetabled IS DISTINCT FROM true))
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAILED: % plan_courses off contract', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.teaching_assignments ta
  JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
  JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
  JOIN public.courses c ON c.id = pc.course_id
  WHERE c.code IN ('USR07','CS111')
    AND (ta.required_room_type IS DISTINCT FROM 'lecture_hall'
      OR ta.session_type NOT IN ('lecture','seminar')
      OR (COALESCE(ta.is_active, true) AND COALESCE(dg.is_obsolete, false)));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAILED: % assignments off contract', v_bad;
  END IF;

  -- Graduation-project semantics untouched: every guard still blocks project work
  -- only when it is excluded from the regular load.
  IF position('COALESCE(pcc.counts_toward_regular_load, true) = false THEN ''PROJECT_NON_WEEKLY'''
       in pg_get_functiondef('public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure)) = 0
     OR position('COALESCE(v_pcc.counts_toward_regular_load, true) = false THEN'
       in pg_get_functiondef('public._sb_v2_assignment_guard(uuid)'::regprocedure)) = 0
     OR position('COALESCE(r.counts_toward_regular_load, false) = false'
       in pg_get_functiondef('public.generate_cohort_delivery_groups(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAILED: weekly/supervision project split not in place';
  END IF;
END
$verify$;