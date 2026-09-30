-- Restore Dr Yahya Qaid Hasan Al-Buraihi to the cross-college assignment picker.
--
-- Production evidence before this repair:
--   * the same instructor already owns active ITCS Calculus assignments;
--   * the canonical faculty directory and assignment candidate picker do not
--     expose him;
--   * published academic affiliations identify his home as the Department of
--     Mathematics, College of Education and Sciences, University of Saba Region.
--
-- The data repair is intentionally fail-closed.  It identifies the person from
-- an existing active ITCS Calculus assignment, not from a bare name match, and
-- refuses to run unless the college, department and instructor are unique.
-- No assignment, delivery group or timetable session is created or changed.

BEGIN;

DO $repair$
DECLARE
  v_itcs_ids uuid[];
  v_home_ids uuid[];
  v_department_ids uuid[];
  v_instructor_ids uuid[];
  v_itcs uuid;
  v_university uuid;
  v_home uuid;
  v_department uuid;
  v_instructor uuid;
  v_identity uuid;
  v_before jsonb;
BEGIN
  SELECT array_agg(c.id ORDER BY c.id), min(c.university_id::text)::uuid
    INTO v_itcs_ids, v_university
  FROM public.colleges c
  WHERE btrim(c.code) = 'ITCS'
     OR btrim(c.name) = 'كلية تكنولوجيا المعلومات وعلوم الحاسوب';

  IF coalesce(cardinality(v_itcs_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_ITCS_NOT_UNIQUE: %', coalesce(cardinality(v_itcs_ids), 0);
  END IF;
  v_itcs := v_itcs_ids[1];
  SELECT c.university_id INTO v_university FROM public.colleges c WHERE c.id = v_itcs;

  SELECT array_agg(c.id ORDER BY c.id)
    INTO v_home_ids
  FROM public.colleges c
  WHERE c.university_id = v_university
    AND btrim(c.name) = 'كلية التربية والعلوم';

  IF coalesce(cardinality(v_home_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_HOME_COLLEGE_NOT_UNIQUE: %', coalesce(cardinality(v_home_ids), 0);
  END IF;
  v_home := v_home_ids[1];

  SELECT array_agg(d.id ORDER BY d.id)
    INTO v_department_ids
  FROM public.departments d
  WHERE d.college_id = v_home
    AND btrim(d.name) ~ '^(قسم[[:space:]]+)?الرياضيات$';

  IF coalesce(cardinality(v_department_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_MATH_DEPARTMENT_NOT_UNIQUE: %',
      coalesce(cardinality(v_department_ids), 0);
  END IF;
  v_department := v_department_ids[1];

  SELECT array_agg(q.id ORDER BY q.id)
    INTO v_instructor_ids
  FROM (
    SELECT DISTINCT i.id
    FROM public.instructors i
    JOIN public.teaching_assignments ta
      ON ta.instructor_id = i.id
     AND ta.is_active
    JOIN public.course_offerings o
      ON o.id = ta.course_offering_id
    JOIN public.courses course
      ON course.id = o.course_id
    WHERE ta.college_id = v_itcs
      AND btrim(course.name) = 'التفاضل والتكامل'
      AND translate(lower(coalesce(nullif(i.full_name_ar, ''), i.full_name)), 'أإآى', 'اااي')
          LIKE '%يحي%'
      AND translate(lower(coalesce(nullif(i.full_name_ar, ''), i.full_name)), 'أإآى', 'اااي')
          LIKE '%البريهي%'
  ) q;

  IF coalesce(cardinality(v_instructor_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_INSTRUCTOR_NOT_UNIQUE: %',
      coalesce(cardinality(v_instructor_ids), 0);
  END IF;
  v_instructor := v_instructor_ids[1];

  SELECT jsonb_build_object(
      'affiliation_college_id', i.affiliation_college_id,
      'affiliation_department_id', i.affiliation_department_id,
      'is_active', i.is_active,
      'availability_status', i.availability_status
    )
    INTO v_before
  FROM public.instructors i
  WHERE i.id = v_instructor
  FOR UPDATE;

  -- The request explicitly confirms that this lecturer is currently available
  -- for another Calculus assignment.  Keep the operational owner (college_id),
  -- existing assignments and sessions intact; only repair canonical affiliation.
  UPDATE public.instructors
  SET affiliation_college_id = v_home,
      affiliation_department_id = v_department,
      is_active = true,
      availability_status = 'available',
      updated_at = now()
  WHERE id = v_instructor;

  IF NOT EXISTS (
    SELECT 1
    FROM public.faculty_identity_links l
    WHERE l.instructor_id = v_instructor
  ) THEN
    PERFORM public.register_instructor_faculty_identity(v_instructor);
  END IF;

  SELECT l.identity_id
    INTO STRICT v_identity
  FROM public.faculty_identity_links l
  WHERE l.instructor_id = v_instructor;

  IF EXISTS (
    SELECT 1
    FROM public.faculty_identity_links l
    JOIN public.instructors member ON member.id = l.instructor_id
    WHERE l.identity_id = v_identity
      AND translate(lower(coalesce(nullif(member.full_name_ar, ''), member.full_name)),
                    'أإآى', 'اااي') NOT LIKE '%البريهي%'
      AND NOT (
        translate(lower(coalesce(nullif(member.full_name_ar, ''), member.full_name)),
                  'أإآى', 'اااي') LIKE '%يحي%'
        AND translate(lower(coalesce(nullif(member.full_name_ar, ''), member.full_name)),
                      'أإآى', 'اااي') LIKE '%قايد%'
      )
  ) THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_IDENTITY_HAS_UNRELATED_MEMBER';
  END IF;

  -- Every operational alias of the same verified identity receives the same
  -- canonical affiliation.  Physical ownership and operational department are
  -- deliberately untouched.
  UPDATE public.instructors member
  SET affiliation_college_id = v_home,
      affiliation_department_id = v_department,
      updated_at = now()
  WHERE EXISTS (
    SELECT 1
    FROM public.faculty_identity_links l
    WHERE l.identity_id = v_identity
      AND l.instructor_id = member.id
  )
    AND (
      member.affiliation_college_id IS DISTINCT FROM v_home
      OR member.affiliation_department_id IS DISTINCT FROM v_department
    );

  IF NOT EXISTS (
    SELECT 1
    FROM faculty_private.home_profiles hp
    JOIN public.faculty_identity_links l ON l.identity_id = hp.identity_id
    JOIN public.instructors eligible ON eligible.id = l.instructor_id
    WHERE hp.identity_id = v_identity
      AND hp.home_college_id = v_home
      AND eligible.is_active
      AND eligible.availability_status = 'available'
  ) THEN
    RAISE EXCEPTION 'YAHYA_REPAIR_HOME_PROFILE_NOT_ASSIGNABLE';
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'faculty_affiliation_repaired',
    'instructors',
    v_instructor,
    v_home,
    jsonb_build_object(
      'migration', '20260930120000_cross_college_yahya_candidate_repair',
      'reason', 'Restore verified cross-college Calculus assignment eligibility',
      'before', v_before,
      'after', jsonb_build_object(
        'affiliation_college_id', v_home,
        'affiliation_department_id', v_department,
        'is_active', true,
        'availability_status', 'available'
      )
    )
  );
END
$repair$;

-- An identity may have a historical home/source row that is inactive while a
-- second operational alias is active and available.  Candidate discovery must
-- use an eligible member of the canonical identity instead of hiding the whole
-- person because one source row cannot receive new work.
CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(
  p_delivery_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_candidates jsonb := '[]'::jsonb;
  v_colleges jsonb := '[]'::jsonb;
  v_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg
  FROM public.operational_delivery_groups
  WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pcc
  FROM public.plan_course_components
  WHERE id = v_dg.component_id;
  v_alloc := public.compute_delivery_group_allocation(p_delivery_group_id);

  SELECT coalesce(
      jsonb_agg(x ORDER BY x.is_home_college DESC, x.college_name, x.full_name),
      '[]'::jsonb
    )
    INTO v_candidates
  FROM (
    SELECT
      eligible.id AS instructor_id,
      coalesce(nullif(eligible.full_name_ar, ''), eligible.full_name) AS full_name,
      eligible.academic_rank,
      hp.home_college_id,
      c.name AS college_name,
      hp.home_college_id = v_dg.college_id AS is_home_college,
      CASE
        WHEN hp.home_college_id = v_dg.college_id THEN eligible.employee_number
        ELSE NULL
      END AS employee_number,
      EXISTS (
        SELECT 1
        FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND ta.is_active
          AND EXISTS (
            SELECT 1
            FROM public.faculty_identity_links assigned_link
            WHERE assigned_link.instructor_id = ta.instructor_id
              AND assigned_link.identity_id = hp.identity_id
          )
      ) AS already_assigned
    FROM faculty_private.home_profiles hp
    JOIN public.colleges c ON c.id = hp.home_college_id
    JOIN LATERAL (
      SELECT member.*
      FROM public.faculty_identity_links member_link
      JOIN public.instructors member ON member.id = member_link.instructor_id
      WHERE member_link.identity_id = hp.identity_id
        AND member.is_active
        AND member.availability_status = 'available'
      ORDER BY
        (member.id = hp.source_instructor_id) DESC,
        (member.college_id = hp.home_college_id) DESC,
        (member.college_id = v_dg.college_id) DESC,
        member.created_at,
        member.id
      LIMIT 1
    ) eligible ON true
    WHERE c.university_id = (
      SELECT college.university_id
      FROM public.colleges college
      WHERE college.id = v_dg.college_id
    )
  ) x;

  SELECT coalesce(
      jsonb_agg(DISTINCT jsonb_build_object(
        'college_id', c.id,
        'college_name', c.name,
        'is_home_college', c.id = v_dg.college_id
      )),
      '[]'::jsonb
    )
    INTO v_colleges
  FROM public.colleges c
  WHERE c.university_id = (
      SELECT college.university_id
      FROM public.colleges college
      WHERE college.id = v_dg.college_id
    )
    AND EXISTS (
      SELECT 1
      FROM faculty_private.home_profiles hp
      JOIN public.faculty_identity_links member_link
        ON member_link.identity_id = hp.identity_id
      JOIN public.instructors member ON member.id = member_link.instructor_id
      WHERE hp.home_college_id = c.id
        AND member.is_active
        AND member.availability_status = 'available'
    );

  RETURN jsonb_build_object(
    'ok', true,
    'delivery_group_id', p_delivery_group_id,
    'college_id', v_dg.college_id,
    'is_obsolete', coalesce(v_dg.is_obsolete, false),
    'active', coalesce(v_dg.active, true),
    'component_type', v_pcc.component_type,
    'component_hours', v_pcc.weekly_contact_hours,
    'allocation', v_alloc,
    'candidates', v_candidates,
    'candidate_colleges', v_colleges,
    'assignable', NOT coalesce(v_dg.is_obsolete, false)
      AND coalesce(v_dg.active, true)
      AND coalesce(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_delivery_group_assignment_candidates(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_group_assignment_candidates(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_delivery_group_assignment_candidates(uuid) IS
  'Assignment candidates by canonical home identity, using one active and available member record per identity.';

COMMIT;
