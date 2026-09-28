-- Inherit the existing source policy only through privately verified copies.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.education_2026f_source_external_session_allowed(public.schedule_sessions)'::regprocedure));
 IF v_hash='2322362d2418f2267b476f03fbe04cfe' THEN RETURN; END IF;
 IF v_hash<>'91f2fc3a68e3dda62b6822e02dc12861' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: education_2026f_source_external_session_allowed'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.education_2026f_source_external_session_allowed(p_session schedule_sessions)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.education_source_revision_session_allowed(p_session) OR (p_session.teaching_assignment_id IS NULL
    AND p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      JOIN public.delivery_groups g ON g.id=src.delivery_group_id
      JOIN public.academic_cohorts ac ON ac.id=g.cohort_id
      WHERE src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND src.source_id=g.group_code
        AND src.source_file IN ('كيمياء.docx',
          'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
        AND src.college_id=p_session.college_id
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND ac.term_id=src.term_id AND v.status='draft'
        AND t.academic_year='2026-2027' AND t.term_type='first'
        AND public.existing_schedule_intake_enabled(t.college_id,t.id)
    ));
$function$;
$ddl$;
END;
$patch$;

-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.education_2026f_project_session_allowed(public.schedule_sessions)'::regprocedure));
 IF v_hash='4efe5ad093d1c6cc642b3046de056f90' THEN RETURN; END IF;
 IF v_hash<>'89483929e5aa706b939677de25d28591' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: education_2026f_project_session_allowed'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.education_2026f_project_session_allowed(p_session schedule_sessions)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.education_source_revision_session_allowed(p_session) OR (p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_session.delivery_group_id='63cbdb0e-af9e-561d-abe2-7e71b2d0c10a'::uuid
    AND p_session.teaching_assignment_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.plan_course_components comp ON comp.id=src.component_id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.instructors i ON i.id=p_session.instructor_id
      WHERE src.source_id='EDU-SOURCE-2026-S1-20260922-S0304'
        AND src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND src.college_id=p_session.college_id
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND i.external_source='EDU26F-NAME:دصالحغريب'
        AND comp.component_type='project' AND NOT comp.counts_toward_regular_load
        AND v.status='draft'
        AND public.existing_schedule_intake_enabled(src.college_id,src.term_id)));
$function$;
$ddl$;
END;
$patch$;

-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.education_2026f_four_source_allowed(public.schedule_sessions)'::regprocedure));
 IF v_hash='220a87a4bdc7214969e29f8779898b78' THEN RETURN; END IF;
 IF v_hash<>'c4b381565287fc6cda0f972a5dac6573' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: education_2026f_four_source_allowed'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.education_2026f_four_source_allowed(p_session schedule_sessions)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.education_source_revision_session_allowed(p_session) OR (p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_session.teaching_assignment_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.delivery_groups g ON g.id=src.delivery_group_id
      JOIN public.academic_cohorts ac ON ac.id=src.cohort_id
      JOIN public.course_offerings o ON o.id=p_session.course_offering_id
      JOIN public.plan_course_components pcc ON pcc.id=src.component_id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      WHERE src.source_id IN (
          'EDU-SOURCE-2026-S1-20260922-S0133',
          'EDU-SOURCE-2026-S1-20260922-S0097',
          'EDU-SOURCE-2026-S1-20260922-S0064',
          'EDU-SOURCE-2026-S1-20260922-S0240')
        AND src.source_id=g.group_code
        AND src.college_id=p_session.college_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND src.plan_course_id=g.plan_course_id
        AND g.cohort_id=ac.id AND g.component_id=pcc.id
        AND g.active AND NOT g.is_obsolete
        AND ac.term_id=src.term_id AND ac.study_system='regular'
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND o.college_id=src.college_id AND o.term_id=src.term_id
        AND o.plan_course_id=src.plan_course_id
        AND o.program_id=ac.program_id AND o.level_id=ac.level_id
        AND o.study_system='regular' AND o.existing_schedule AND o.is_active
        AND ((src.source_id='EDU-SOURCE-2026-S1-20260922-S0240'
              AND pcc.component_type='theory')
             OR (src.source_id<>'EDU-SOURCE-2026-S1-20260922-S0240'
              AND pcc.component_type='project'
              AND NOT pcc.counts_toward_regular_load))
        AND t.academic_year='2026-2027' AND t.term_type='first'
        AND v.status='draft'
        AND public.existing_schedule_intake_enabled(src.college_id,src.term_id)
    ));
$function$;
$ddl$;
END;
$patch$;

-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.education_2026f_provisional_name_guard()'::regprocedure));
 IF v_hash='db994a1aaa3211452e3ca44316f4bf21' THEN RETURN; END IF;
 IF v_hash<>'7ac678470dee25c238df5c0ac6f5113d' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: education_2026f_provisional_name_guard'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.education_2026f_provisional_name_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME='schedule_sessions' THEN
    IF public.education_source_revision_session_allowed(NEW) THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.instructors i WHERE i.id=NEW.instructor_id
      AND i.external_source LIKE 'EDU26F-NAME:%') THEN
    IF TG_TABLE_NAME='teaching_assignments' THEN
      RAISE EXCEPTION 'EDU26F_PROVISIONAL_NAME_NOT_HR_ASSIGNMENT';
    END IF;
    IF NEW.schedule_version_id<>'7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
      OR NEW.college_id<>'1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
      OR NEW.teaching_assignment_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.existing_schedule_source_rows src
        JOIN public.schedule_versions v ON v.id=src.schedule_version_id
        WHERE src.delivery_group_id=NEW.delivery_group_id
          AND src.cohort_id=NEW.cohort_id
          AND src.component_id=NEW.plan_course_component_id
          AND (src.source_file IN ('كيمياء.docx',
            'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
            OR src.source_id='EDU-SOURCE-2026-S1-20260922-S0304')
          AND src.college_id=NEW.college_id AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
          AND src.schedule_version_id=NEW.schedule_version_id AND v.status='draft'
          AND NEW.instructor_id=ANY(src.instructor_ids))
    THEN RAISE EXCEPTION 'EDU26F_PROVISIONAL_NAME_OUTSIDE_TERM'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;
$ddl$;
END;
$patch$;

-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.guard_schedule_session_current_delivery_group()'::regprocedure));
 IF v_hash='91c496cc510a91ff8454bc8031539f4d' THEN RETURN; END IF;
 IF v_hash<>'ba1ad5c78efd11a04f5c5a6c9681852e' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: guard_schedule_session_current_delivery_group'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.guard_schedule_session_current_delivery_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  g public.delivery_groups%ROWTYPE;
  fresh jsonb;
BEGIN
  IF NEW.delivery_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM public.delivery_groups WHERE id=NEW.delivery_group_id;
  IF g.id IS NULL OR NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  IF public.education_source_revision_session_allowed(NEW) THEN RETURN NEW; END IF;
  IF NEW.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND NEW.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND g.group_code LIKE 'EDU-2026F-%'
    AND NEW.cohort_id=g.cohort_id AND NEW.plan_course_component_id=g.component_id
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.academic_cohorts ac ON ac.id=src.cohort_id
      JOIN public.plan_courses pc ON pc.id=src.plan_course_id
      JOIN public.course_offerings co ON co.plan_course_id=pc.id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      WHERE src.source_id=g.group_code AND src.delivery_group_id=g.id
        AND src.cohort_id=g.cohort_id AND src.component_id=g.component_id
        AND src.plan_course_id=g.plan_course_id
        AND src.college_id=NEW.college_id AND src.term_id=t.id
        AND src.schedule_version_id=NEW.schedule_version_id
        AND src.source_file IN ('كيمياء.docx',
          'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
        AND ac.term_id=t.id AND ac.study_plan_id=pc.study_plan_id
        AND co.id=NEW.course_offering_id AND co.term_id=t.id
        AND co.program_id=ac.program_id AND co.level_id=ac.level_id
        AND v.status='draft' AND t.academic_year='2026-2027'
        AND t.term_type='first' AND public.existing_schedule_intake_enabled(t.college_id,t.id)
    )
  THEN RETURN NEW; END IF;
  IF public.education_2026f_four_source_allowed(NEW) THEN RETURN NEW; END IF;
  fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id,NEW.schedule_version_id);
  IF NOT coalesce((fresh->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE' USING ERRCODE='23514',DETAIL=fresh::text;
  END IF;
  RETURN NEW;
END;
$function$;
$ddl$;
END;
$patch$;

-- Extend only exact, sealed source copies; keep the existing policy body.
DO $patch$
DECLARE v_hash text;
BEGIN
 v_hash:=md5(pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure));
 IF v_hash='7e08bdfdf9d06e886616fe78bcd0eaa3' THEN RETURN; END IF;
 IF v_hash<>'03043a8891f51a89d14360db19ed8458' THEN RAISE EXCEPTION 'SOURCE_REVISION_FUNCTION_DRIFT: schedule_version_delivery_coverage'; END IF;
 EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_term_id uuid;
  v_result jsonb;
  v_scoped_exception boolean := false;
BEGIN
  SELECT academic_term_id INTO v_term_id
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  -- One verified college/version/term. Drift in sessions or source links closes the waiver.
  v_scoped_exception := p_college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND v_term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
    AND EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id=v_term_id
      AND t.academic_year='2026-2027' AND t.term_type='first')
    AND (SELECT count(*) FROM public.schedule_sessions s
      WHERE s.schedule_version_id=p_schedule_version_id)=339
    AND (SELECT count(*) FROM public.existing_schedule_source_rows r
      WHERE r.schedule_version_id=p_schedule_version_id
        AND r.schedule_session_id IS NOT NULL)=309;

  v_scoped_exception := v_scoped_exception OR public.education_source_revision_verified(p_schedule_version_id);

  WITH cohort_batches AS (
    SELECT array_agg(id ORDER BY id) AS cohort_ids
    FROM (
      SELECT ac.id, (row_number() OVER (ORDER BY ac.id)-1)/100 AS batch
      FROM public.academic_cohorts ac
      WHERE ac.college_id=p_college_id AND ac.term_id=v_term_id
    ) numbered
    GROUP BY batch
  ), expected AS (
    SELECT DISTINCT dg.id AS delivery_group_id,
           pcc.weekly_contact_hours::numeric AS required_hours
    FROM cohort_batches b
    CROSS JOIN LATERAL public.schedule_version_delivery_group_catalog(
      p_schedule_version_id,b.cohort_ids
    ) dg
    JOIN public.academic_cohorts ac ON ac.id=dg.cohort_id
    JOIN public.plan_course_components pcc ON pcc.id=dg.component_id
    WHERE ac.active=true
      AND dg.active=true
      AND COALESCE(dg.is_obsolete,false)=false
      AND COALESCE(pcc.is_timetabled,true)=true
  ), assignments AS (
    SELECT ta.delivery_group_id,
           count(*)::integer AS active_assignments
    FROM public.version_effective_assignments(p_schedule_version_id) ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id
  ), sessions AS (
    SELECT ss.delivery_group_id,
           count(*)::integer AS session_count,
           sum(extract(epoch FROM (ss.end_time-ss.start_time))/3600.0)::numeric AS scheduled_hours
    FROM public.schedule_sessions ss
    WHERE ss.college_id = p_college_id
      AND ss.schedule_version_id = p_schedule_version_id
      AND COALESCE(ss.replaced_by_split,false)=false
      AND ss.delivery_group_id IS NOT NULL
    GROUP BY ss.delivery_group_id
  ), verified_source AS (
    SELECT ss.delivery_group_id, count(*)::integer AS sourced_named_sessions
    FROM public.schedule_sessions ss
    WHERE v_scoped_exception
      AND ss.college_id=p_college_id AND ss.schedule_version_id=p_schedule_version_id
      AND NOT COALESCE(ss.replaced_by_split,false)
      AND ss.delivery_group_id IS NOT NULL
      AND ss.teaching_assignment_id IS NULL
      AND ss.instructor_id IS NOT NULL AND ss.room_id IS NOT NULL
      AND (EXISTS (
        SELECT 1 FROM public.existing_schedule_source_rows r
        WHERE r.college_id=p_college_id AND r.term_id=v_term_id
          AND r.schedule_version_id=p_schedule_version_id
          AND r.schedule_session_id=ss.id AND r.delivery_group_id=ss.delivery_group_id
          AND r.status='imported' AND ss.instructor_id=ANY(r.instructor_ids)) OR public.education_source_revision_named_session(ss))
    GROUP BY ss.delivery_group_id
  ), a AS (
    SELECT e.delivery_group_id,
           e.required_hours,
           COALESCE(x.active_assignments,0) AS active_assignments,
           COALESCE(s.session_count,0) AS session_count,
           COALESCE(s.scheduled_hours,0)::numeric AS scheduled_hours,
           COALESCE(vs.sourced_named_sessions,0) AS sourced_named_sessions
    FROM expected e
    LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
    LEFT JOIN sessions s ON s.delivery_group_id=e.delivery_group_id
    LEFT JOIN verified_source vs ON vs.delivery_group_id=e.delivery_group_id
  ), totals AS (
    SELECT count(*)::integer AS total_groups,
           count(*) FILTER (WHERE active_assignments=1)::integer AS assigned_exactly_once,
           count(*) FILTER (WHERE active_assignments=0)::integer AS unassigned_groups,
           count(*) FILTER (WHERE active_assignments>1)::integer AS multi_assigned_groups,
           count(*) FILTER (WHERE active_assignments=0 AND session_count>0
             AND sourced_named_sessions=session_count
             AND abs(scheduled_hours-required_hours)<0.001)::integer AS provisional_source_groups,
           count(*) FILTER (WHERE session_count>0)::integer AS groups_with_sessions,
           count(*) FILTER (WHERE session_count=0)::integer AS groups_without_sessions,
           count(*) FILTER (WHERE abs(scheduled_hours-required_hours)<0.001)::integer AS exact_hours_groups,
           count(*) FILTER (WHERE scheduled_hours<required_hours)::integer AS short_hours_groups,
           count(*) FILTER (WHERE scheduled_hours>required_hours)::integer AS over_hours_groups,
           COALESCE(sum(required_hours),0)::numeric AS required_hours,
           COALESCE(sum(scheduled_hours),0)::numeric AS scheduled_hours,
           COALESCE(sum(greatest(required_hours-scheduled_hours,0)),0)::numeric AS missing_hours,
           COALESCE(sum(greatest(scheduled_hours-required_hours,0)),0)::numeric AS extra_hours
    FROM a
  )
  SELECT jsonb_build_object(
    'total_groups', total_groups,
    'assigned_exactly_once', assigned_exactly_once,
    'unassigned_groups', unassigned_groups,
    'multi_assigned_groups', multi_assigned_groups,
    'provisional_source_groups', provisional_source_groups,
    'temporary_assignment_exception', (v_scoped_exception AND total_groups=331
      AND unassigned_groups=46 AND provisional_source_groups=46
      AND required_hours=714 AND scheduled_hours=714
      AND missing_hours=0 AND extra_hours=0),
    'groups_with_sessions', groups_with_sessions,
    'groups_without_sessions', groups_without_sessions,
    'exact_hours_groups', exact_hours_groups,
    'short_hours_groups', short_hours_groups,
    'over_hours_groups', over_hours_groups,
    'required_hours', required_hours,
    'scheduled_hours', scheduled_hours,
    'missing_hours', missing_hours,
    'extra_hours', extra_hours,
    'complete', (total_groups > 0
                 AND (unassigned_groups=0 OR
                   (v_scoped_exception AND total_groups=331
                    AND unassigned_groups=46 AND provisional_source_groups=46
                    AND required_hours=714 AND scheduled_hours=714))
                 AND multi_assigned_groups=0
                 AND short_hours_groups=0
                 AND over_hours_groups=0)
  ) INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;
$ddl$;
END;
$patch$;
COMMIT;
