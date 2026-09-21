-- Read-only college dean executive dashboard, scoped from auth.uid() -> user_colleges.
-- No client supplied college can widen this scope.
-- Fail-closed role predicate; it grants no write capability.
CREATE OR REPLACE FUNCTION public.is_college_dean(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_role(_user_id, 'college_dean'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.is_college_dean(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_college_dean(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leadership_overview(p_academic_year text DEFAULT NULL::text, p_term_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_year text := p_academic_year;
  v_type text := p_term_type;
  v_periods jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_workspace jsonb;
  v_colleges jsonb;
  v_result jsonb;
  v_college record;
  v_scope_college uuid;
  v_scope_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.is_super_admin(v_actor)
    OR public.has_role(v_actor, 'university_leadership'::public.app_role)
    OR public.has_role(v_actor, 'college_dean'::public.app_role)
  ) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;

  IF public.has_role(v_actor, 'college_dean'::public.app_role)
     AND NOT public.is_super_admin(v_actor)
     AND NOT public.has_role(v_actor, 'university_leadership'::public.app_role) THEN
    SELECT min(uc.college_id), count(*)
      INTO v_scope_college, v_scope_count
    FROM public.user_colleges uc
    WHERE uc.user_id = v_actor;
    IF v_scope_count <> 1 THEN
      RAISE EXCEPTION 'COLLEGE_DEAN_REQUIRES_EXACTLY_ONE_COLLEGE'
        USING ERRCODE='42501';
    END IF;
  END IF;

  -- An explicit year in the term name may fill missing metadata for reporting
  -- only. It is flagged, never written back, and ambiguous matches are withheld.
  WITH terms AS (
    SELECT t.*,
      coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) AS year_key
    FROM public.academic_terms t
    JOIN public.colleges cl ON cl.id=t.college_id
    WHERE NOT (
      upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
      OR cl.name ILIKE '%اختبار تبسيط الجداول%'
    )
      AND (v_scope_college IS NULL OR cl.id=v_scope_college)
  )
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'year' DESC, x->>'type'), '[]'::jsonb)
  INTO v_periods FROM (
    SELECT DISTINCT jsonb_build_object('year',year_key,'type',term_type) AS x
    FROM terms WHERE year_key IS NOT NULL AND term_type IS NOT NULL
  ) q;

  IF v_year IS NULL AND v_type IS NULL THEN
    SELECT coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')), t.term_type
    INTO v_year,v_type
    FROM public.academic_terms t
    JOIN public.colleges cl ON cl.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) IS NOT NULL
      AND t.term_type IS NOT NULL
      AND NOT (
        upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
        OR cl.name ILIKE '%اختبار تبسيط الجداول%'
      )
    ORDER BY (t.start_date <= current_date) DESC NULLS LAST,t.start_date DESC NULLS LAST,t.id LIMIT 1;
  ELSIF v_year IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'ACADEMIC_PERIOD_REQUIRED';
  END IF;
  IF v_year IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_periods) p WHERE p->>'year'=v_year AND p->>'type'=v_type
  ) THEN RAISE EXCEPTION 'ACADEMIC_PERIOD_NOT_FOUND'; END IF;

  WITH matches AS (
    SELECT t.*,count(*) OVER (PARTITION BY t.college_id) AS matches
    FROM public.academic_terms t
    JOIN public.colleges source_college ON source_college.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year
      AND t.term_type=v_type
      AND NOT (
        upper(btrim(coalesce(source_college.code,''))) LIKE 'TEST%'
        OR source_college.name ILIKE '%اختبار تبسيط الجداول%'
      )
      AND (v_scope_college IS NULL OR source_college.id=v_scope_college)
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id',cl.id,'name',cl.name,
    'term_id',m.id,'term_name',m.name,
    'term_state',CASE WHEN m.id IS NOT NULL THEN 'ready'
      WHEN EXISTS(SELECT 1 FROM matches a WHERE a.college_id=cl.id) THEN 'ambiguous' ELSE 'missing' END,
    'year_inferred',m.academic_year IS NULL OR btrim(m.academic_year)=''
  ) ORDER BY cl.name) INTO v_colleges
  FROM public.colleges cl
  LEFT JOIN matches m ON m.college_id=cl.id AND m.matches=1
  WHERE NOT (
    upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
    OR cl.name ILIKE '%اختبار تبسيط الجداول%'
  )
    AND (v_scope_college IS NULL OR cl.id=v_scope_college);

  FOR v_college IN SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid,term_id uuid) LOOP
    IF v_college.term_id IS NOT NULL THEN
      v_workspace := public.list_teaching_assignment_workspace(p_college_id=>v_college.id,p_term_id=>v_college.term_id);
      IF coalesce((v_workspace->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'WORKSPACE_UNAVAILABLE'; END IF;
      v_groups := v_groups || coalesce(v_workspace->'rows','[]');
    END IF;
  END LOOP;

  WITH colleges AS (
    SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(
      id uuid,name text,term_id uuid,term_name text,term_state text,year_inferred boolean)
  ), groups AS MATERIALIZED (
    SELECT g.*, p.counts_toward_regular_load,
      EXISTS(SELECT 1 FROM jsonb_array_elements(g.instructors) a
        WHERE coalesce((a->>'is_active')::boolean,true) AND a->>'assigned_component_hours' IS NULL)
        AND jsonb_array_length(g.instructors)>1 AS pending
    FROM jsonb_to_recordset(v_groups) AS g(
      delivery_group_id uuid,college_id uuid,component_type text,component_hours numeric,
      assigned_hours_total numeric,remaining_hours numeric,active boolean,is_obsolete boolean,
      excluded_from_standard_workload boolean,plan_course_component_id uuid,instructors jsonb)
    JOIN public.plan_course_components p ON p.id=g.plan_course_component_id
    WHERE g.active AND NOT g.is_obsolete
  ), coverage AS (
    SELECT college_id,count(*) AS groups_count,
      count(*) FILTER(WHERE remaining_hours=0 AND NOT pending) AS covered_groups,
      sum(component_hours) AS required_hours,
      sum(least(component_hours,assigned_hours_total)) FILTER(WHERE NOT pending) AS covered_hours,
      sum(assigned_hours_total) AS assigned_hours,
      sum(remaining_hours) FILTER(WHERE NOT pending) AS uncovered_hours,
      count(*) FILTER(WHERE pending) AS pending_groups,
      sum(component_hours) FILTER(WHERE pending) AS pending_group_hours,
      count(*) FILTER(WHERE assigned_hours_total>component_hours) AS overallocated_groups
    FROM groups GROUP BY college_id
  ), directory_profiles AS MATERIALIZED (
    SELECT h.source_instructor_id AS id,h.home_college_id AS college_id,h.identity_id,h.home_college_id AS home_id,
      coalesce(nullif(btrim(h.academic_rank),''),'غير محدد') AS academic_rank,
      coalesce(nullif(btrim(h.employment_type),''),'unknown') AS employment_type,h.is_active,
      nullif(btrim(CASE WHEN position('الحالة الوظيفية: ' in coalesce(i.notes,''))>0
       THEN split_part(split_part(i.notes,'الحالة الوظيفية: ',2),E'\n',1)
       WHEN position('الحالة في الكشف: ' in coalesce(i.notes,''))>0
       THEN split_part(split_part(split_part(i.notes,'الحالة في الكشف: ',2),E'\n',1),'—',1) ELSE '' END),'') AS status_reason
    FROM faculty_private.home_profiles h JOIN instructors i ON i.id=h.source_instructor_id
  ), directory_totals AS (
    SELECT home_id,count(*)::int AS faculty_directory_count
    FROM directory_profiles GROUP BY home_id
  ), rank_totals AS (
    SELECT home_id,jsonb_object_agg(academic_rank,cnt ORDER BY academic_rank) AS rank_counts
    FROM (
      SELECT home_id,academic_rank,count(*)::int AS cnt
      FROM directory_profiles
      GROUP BY home_id,academic_rank
    ) q
    GROUP BY home_id
  ), availability_totals AS (
    SELECT home_id,jsonb_object_agg(status_label,cnt ORDER BY status_label) AS availability_counts
    FROM (
      SELECT home_id,status_label,count(*)::int AS cnt
      FROM (
        SELECT home_id,
          CASE
            WHEN status_reason IS NOT NULL THEN status_reason
            WHEN is_active THEN 'متاح'
            ELSE 'غير متاح'
          END AS status_label
        FROM directory_profiles
      ) labelled
      GROUP BY home_id,status_label
    ) q
    GROUP BY home_id
  ), employment_totals AS (
    SELECT home_id,jsonb_object_agg(employment_type,cnt ORDER BY employment_type) AS employment_counts
    FROM (
      SELECT home_id,employment_type,count(*)::int AS cnt
      FROM directory_profiles
      GROUP BY home_id,employment_type
    ) q
    GROUP BY home_id
  ), members AS MATERIALIZED (
    SELECT h.identity_id,h.home_college_id AS home_id,h.quota,h.quota IS NULL AS missing_quota
    FROM faculty_private.home_profiles h WHERE h.is_active
  ), staff_load AS (
    SELECT coalesce(l.identity_id,(a->>'instructor_id')::uuid) AS identity_id,
      sum(CASE WHEN g.excluded_from_standard_workload OR NOT coalesce(g.counts_toward_regular_load,true)
        OR g.component_type='summer_training' THEN 0
        ELSE coalesce((a->>'assigned_component_hours')::numeric,
          CASE WHEN jsonb_array_length(g.instructors)=1 THEN g.component_hours ELSE 0 END) END) AS hours,
      bool_or(g.pending AND a->>'assigned_component_hours' IS NULL) AS pending
    FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.instructors) a
    LEFT JOIN public.faculty_identity_links l ON l.instructor_id=(a->>'instructor_id')::uuid
    WHERE coalesce((a->>'is_active')::boolean,true) GROUP BY 1
  ), unique_staff AS (
    SELECT m.identity_id,m.home_id,
      max(m.quota) AS quota,
      bool_or(m.missing_quota) OR count(DISTINCT m.quota)>1 AS uncertain
    FROM members m GROUP BY m.identity_id,m.home_id
  ), staff AS (
    SELECT s.home_id,count(*) AS faculty_count,
      count(*) FILTER(WHERE s.uncertain OR coalesce(w.pending,false)) AS incomplete_faculty,
      sum(s.quota) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS net_quota,
      sum(coalesce(w.hours,0)) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS faculty_assigned_hours,
      sum(greatest(0,coalesce(w.hours,0)-s.quota)) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS overload,
      sum(greatest(0,s.quota-coalesce(w.hours,0))) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS deficit
    FROM unique_staff s LEFT JOIN staff_load w ON w.identity_id=s.identity_id GROUP BY s.home_id
  ), versions AS (
    SELECT DISTINCT ON (v.college_id) v.id,v.college_id,v.name,v.updated_at
    FROM public.schedule_versions v JOIN colleges c ON c.id=v.college_id AND c.term_id=v.academic_term_id
    WHERE v.status='published' AND NOT v.disposable_test
    ORDER BY v.college_id,v.created_at DESC,v.id
  ), sessions AS (
    SELECT s.*,coalesce(p.component_type,s.session_type) AS component,
      extract(epoch FROM (s.end_time-s.start_time))/3600 AS hours
    FROM public.schedule_sessions s JOIN versions v ON v.id=s.schedule_version_id
    LEFT JOIN public.plan_course_components p ON p.id=s.plan_course_component_id
    WHERE NOT s.replaced_by_split AND s.college_id=v.college_id
  ), teaching AS (
    SELECT college_id,count(*) AS sessions_count,sum(hours) AS teaching_hours,
      sum(hours) FILTER(WHERE component='theory') AS theory_hours,
      sum(hours) FILTER(WHERE component IN ('practical','lab','clinical','field_training')) AS practical_hours,
      sum(hours) FILTER(WHERE component NOT IN ('theory','practical','lab','clinical','field_training') OR component IS NULL) AS other_hours
    FROM sessions GROUP BY college_id
  ), resources AS (
    SELECT r.college_id,count(*) AS room_count,
      count(*) FILTER(WHERE coalesce(rt.code,r.room_type)='lecture_hall') AS halls,
      count(*) FILTER(WHERE coalesce(rt.code,r.room_type) IN ('computer_lab','lab','laboratory')) AS labs,
      sum(r.capacity) AS seats
    FROM public.rooms r LEFT JOIN public.room_types rt ON rt.id=r.room_type_id
    WHERE r.is_active GROUP BY r.college_id
  ), counts AS (
    SELECT c.id,
      (SELECT count(*) FROM public.departments d WHERE d.college_id=c.id) AS departments,
      (SELECT count(*) FROM public.academic_programs p WHERE p.college_id=c.id) AS programs
    FROM colleges c
  )
  SELECT jsonb_agg(jsonb_build_object(
    'college_id',c.id,'college',c.name,'term_id',c.term_id,'term',c.term_name,'term_state',c.term_state,'year_inferred',c.year_inferred,
    'departments',ct.departments,'programs',ct.programs,
    'teaching_contributors',(SELECT count(DISTINCT coalesce(l.identity_id,(a->>'instructor_id')::uuid))
     FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.instructors) a
     LEFT JOIN faculty_identity_links l ON l.instructor_id=(a->>'instructor_id')::uuid
     WHERE g.college_id=c.id AND coalesce((a->>'is_active')::boolean,true)),
    'external_contributors',(SELECT count(DISTINCT hp.identity_id)
     FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.instructors) a
     JOIN faculty_identity_links l ON l.instructor_id=(a->>'instructor_id')::uuid
     JOIN faculty_private.home_profiles hp ON hp.identity_id=l.identity_id
     WHERE g.college_id=c.id AND hp.home_college_id<>c.id AND coalesce((a->>'is_active')::boolean,true)),
    'faculty_directory_count',coalesce(dt.faculty_directory_count,0),
    'rank_counts',coalesce(ranks.rank_counts,'{}'::jsonb),
    'availability_counts',coalesce(avail.availability_counts,'{}'::jsonb),
    'employment_counts',coalesce(emp.employment_counts,'{}'::jsonb),
    'faculty_count',coalesce(st.faculty_count,0),'incomplete_faculty',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.incomplete_faculty,0) END,
    'net_quota',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.net_quota,0) END,
    'faculty_assigned_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.faculty_assigned_hours,0) END,
    'overload',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.overload,0) END,
    'deficit',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.deficit,0) END,
    'groups_count',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.groups_count,0) END,
    'covered_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.covered_groups,0) END,
    'required_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.required_hours,0) END,
    'covered_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.covered_hours,0) END,
    'assigned_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.assigned_hours,0) END,
    'uncovered_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.uncovered_hours,0) END,
    'pending_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.pending_groups,0) END,
    'pending_group_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.pending_group_hours,0) END,
    'overallocated_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.overallocated_groups,0) END,
    'version_id',v.id,'version',v.name,'version_updated_at',v.updated_at,
    'sessions_count',CASE WHEN v.id IS NOT NULL THEN coalesce(t.sessions_count,0) END,
    'teaching_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.teaching_hours,0) END,
    'theory_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.theory_hours,0) END,
    'practical_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.practical_hours,0) END,
    'other_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.other_hours,0) END,
    'room_count',coalesce(r.room_count,0),'halls',coalesce(r.halls,0),'labs',coalesce(r.labs,0),'seats',coalesce(r.seats,0),
    'used_rooms',CASE WHEN v.id IS NOT NULL THEN (SELECT count(*) FROM public.rooms room
      WHERE room.college_id=c.id AND room.is_active AND EXISTS(SELECT 1 FROM sessions ss WHERE ss.room_id=room.id)) END
  ) ORDER BY c.name) INTO v_result
  FROM colleges c LEFT JOIN coverage cv ON cv.college_id=c.id
  LEFT JOIN directory_totals dt ON dt.home_id=c.id
  LEFT JOIN rank_totals ranks ON ranks.home_id=c.id
  LEFT JOIN availability_totals avail ON avail.home_id=c.id
  LEFT JOIN employment_totals emp ON emp.home_id=c.id
  LEFT JOIN staff st ON st.home_id=c.id LEFT JOIN versions v ON v.college_id=c.id
  LEFT JOIN teaching t ON t.college_id=c.id LEFT JOIN resources r ON r.college_id=c.id
  JOIN counts ct ON ct.id=c.id;

  RETURN jsonb_build_object('year',v_year,'term_type',v_type,'periods',v_periods,
    'generated_at',now(),'colleges',coalesce(v_result,'[]'),
    'unresolved_faculty',(SELECT count(*) FROM faculty_private.home_profiles h
      WHERE h.home_college_id IS NULL AND EXISTS(SELECT 1 FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
        JOIN colleges c ON c.id=i.college_id WHERE l.identity_id=h.identity_id AND upper(btrim(coalesce(c.code,''))) NOT LIKE 'TEST%'
          AND (v_scope_college IS NULL OR c.id=v_scope_college))),
    'unique_faculty',(SELECT count(*) FROM faculty_private.home_profiles h
      WHERE (v_scope_college IS NULL OR h.home_college_id=v_scope_college)
        AND EXISTS(SELECT 1 FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
        JOIN colleges c ON c.id=i.college_id WHERE l.identity_id=h.identity_id AND upper(btrim(coalesce(c.code,''))) NOT LIKE 'TEST%')));
END;
$function$;


REVOKE ALL ON FUNCTION public.leadership_overview(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leadership_overview(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.leadership_metric_details(
  p_metric text,
  p_academic_year text DEFAULT NULL::text,
  p_term_type text DEFAULT NULL::text,
  p_college_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_year text := p_academic_year;
  v_type text := p_term_type;
  v_colleges jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_workspace jsonb;
  v_college record;
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
  v_scope_college uuid;
  v_scope_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.is_super_admin(v_actor)
    OR public.has_role(v_actor, 'university_leadership'::public.app_role)
    OR public.has_role(v_actor, 'college_dean'::public.app_role)
  ) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;

  IF public.has_role(v_actor, 'college_dean'::public.app_role)
     AND NOT public.is_super_admin(v_actor)
     AND NOT public.has_role(v_actor, 'university_leadership'::public.app_role) THEN
    SELECT min(uc.college_id), count(*)
      INTO v_scope_college, v_scope_count
    FROM public.user_colleges uc
    WHERE uc.user_id = v_actor;
    IF v_scope_count <> 1 THEN
      RAISE EXCEPTION 'COLLEGE_DEAN_REQUIRES_EXACTLY_ONE_COLLEGE'
        USING ERRCODE='42501';
    END IF;
    IF p_college_id IS NOT NULL AND p_college_id <> v_scope_college THEN
      RAISE EXCEPTION 'COLLEGE_SCOPE_VIOLATION' USING ERRCODE='42501';
    END IF;
    p_college_id := v_scope_college;
  END IF;

  IF p_metric IS NULL OR p_metric NOT IN ('faculty','teaching','schedules') THEN
    RAISE EXCEPTION 'UNKNOWN_METRIC';
  END IF;

  IF v_year IS NULL AND v_type IS NULL THEN
    SELECT coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')), t.term_type
    INTO v_year, v_type
    FROM public.academic_terms t
    JOIN public.colleges cl ON cl.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) IS NOT NULL
      AND t.term_type IS NOT NULL
      AND NOT (
        upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
        OR cl.name ILIKE '%اختبار تبسيط الجداول%'
      )
      AND (p_college_id IS NULL OR cl.id=p_college_id)
    ORDER BY (t.start_date <= current_date) DESC NULLS LAST, t.start_date DESC NULLS LAST, t.id
    LIMIT 1;
  ELSIF v_year IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'ACADEMIC_PERIOD_REQUIRED';
  END IF;

  WITH matches AS (
    SELECT t.*, count(*) OVER (PARTITION BY t.college_id) AS matches
    FROM public.academic_terms t
    JOIN public.colleges sc ON sc.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year
      AND t.term_type=v_type
      AND NOT (
        upper(btrim(coalesce(sc.code,''))) LIKE 'TEST%'
        OR sc.name ILIKE '%اختبار تبسيط الجداول%'
      )
      AND (p_college_id IS NULL OR sc.id=p_college_id)
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', cl.id, 'name', cl.name, 'term_id', m.id, 'term_name', m.name
  ) ORDER BY cl.name) INTO v_colleges
  FROM public.colleges cl
  LEFT JOIN matches m ON m.college_id=cl.id AND m.matches=1
  WHERE NOT (
    upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
    OR cl.name ILIKE '%اختبار تبسيط الجداول%'
  )
  AND (p_college_id IS NULL OR cl.id=p_college_id);

  FOR v_college IN SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid, term_id uuid) LOOP
    IF v_college.term_id IS NOT NULL THEN
      v_workspace := public.list_teaching_assignment_workspace(
        p_college_id=>v_college.id, p_term_id=>v_college.term_id);
      IF coalesce((v_workspace->>'ok')::boolean,false)=false THEN
        RAISE EXCEPTION 'WORKSPACE_UNAVAILABLE';
      END IF;
      v_groups := v_groups || coalesce(v_workspace->'rows','[]');
    END IF;
  END LOOP;

  IF p_metric = 'teaching' THEN
    WITH colleges AS (
      SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid, name text, term_id uuid, term_name text)
    ), groups AS MATERIALIZED (
      SELECT g.*, p.counts_toward_regular_load,
        EXISTS(SELECT 1 FROM jsonb_array_elements(g.instructors) a
          WHERE coalesce((a->>'is_active')::boolean,true) AND a->>'assigned_component_hours' IS NULL)
          AND jsonb_array_length(g.instructors)>1 AS pending
      FROM jsonb_to_recordset(v_groups) AS g(
        delivery_group_id uuid, college_id uuid, cohort_id uuid, cohort_code text,
        program_id uuid, study_system text, course_code text, course_name text,
        group_number int, group_code text, component_type text, component_hours numeric,
        assigned_hours_total numeric, remaining_hours numeric, assignment_count int,
        allocation_status text, active boolean, is_obsolete boolean,
        excluded_from_standard_workload boolean, plan_course_component_id uuid, instructors jsonb)
      JOIN public.plan_course_components p ON p.id=g.plan_course_component_id
      WHERE g.active AND NOT g.is_obsolete
    ), detail AS (
      SELECT c.name AS college_name, g.*,
        pr.name AS program_name,
        d.name AS department_name,
        (SELECT string_agg(coalesce(nullif(btrim(a->>'instructor_name'),''),'غير محسوب'), ' · ' ORDER BY a->>'instructor_name')
         FROM jsonb_array_elements(g.instructors) a
         WHERE coalesce((a->>'is_active')::boolean,true)) AS instructors_label
      FROM groups g
      JOIN colleges c ON c.id=g.college_id
      LEFT JOIN public.academic_programs pr ON pr.id=g.program_id
      LEFT JOIN public.departments d ON d.id=pr.department_id
    )
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'id', delivery_group_id,
        'college_id', college_id,
        'college', college_name,
        'department', department_name,
        'program', program_name,
        'study_system', study_system,
        'cohort', cohort_code,
        'course_code', course_code,
        'course', course_name,
        'component_type', component_type,
        'group_code', coalesce(group_code, group_number::text),
        'required_hours', coalesce(component_hours,0),
        'assigned_hours', coalesce(assigned_hours_total,0),
        'uncovered_hours', CASE WHEN pending THEN NULL ELSE coalesce(remaining_hours,0) END,
        'covered_hours', CASE WHEN pending THEN NULL ELSE least(coalesce(component_hours,0), coalesce(assigned_hours_total,0)) END,
        'assignment_status', allocation_status,
        'pending_distribution', pending,
        'instructors', instructors_label
      ) ORDER BY college_name, course_code, component_type, group_number),'[]'::jsonb),
      jsonb_build_object(
        'records', count(*),
        'required_hours', coalesce(sum(component_hours),0),
        'covered_hours', coalesce(sum(least(coalesce(component_hours,0), coalesce(assigned_hours_total,0))) FILTER (WHERE NOT pending),0),
        'assigned_hours', coalesce(sum(assigned_hours_total),0),
        'uncovered_hours', coalesce(sum(remaining_hours) FILTER (WHERE NOT pending),0),
        'pending_groups', count(*) FILTER (WHERE pending),
        'pending_group_hours', coalesce(sum(component_hours) FILTER (WHERE pending),0)
      )
    INTO v_rows, v_totals FROM detail;

  ELSIF p_metric = 'faculty' THEN
    WITH colleges AS (
      SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid, name text, term_id uuid, term_name text)
    ), groups AS MATERIALIZED (
      SELECT g.*, p.counts_toward_regular_load,
        EXISTS(SELECT 1 FROM jsonb_array_elements(g.instructors) a
          WHERE coalesce((a->>'is_active')::boolean,true) AND a->>'assigned_component_hours' IS NULL)
          AND jsonb_array_length(g.instructors)>1 AS pending
      FROM jsonb_to_recordset(v_groups) AS g(
        delivery_group_id uuid, college_id uuid, component_type text, component_hours numeric,
        assigned_hours_total numeric, remaining_hours numeric, active boolean, is_obsolete boolean,
        excluded_from_standard_workload boolean, plan_course_component_id uuid, instructors jsonb)
      JOIN public.plan_course_components p ON p.id=g.plan_course_component_id
      WHERE g.active AND NOT g.is_obsolete
    ), staff_load AS (
      SELECT coalesce(l.identity_id,(a->>'instructor_id')::uuid) AS identity_id,
        sum(CASE WHEN g.excluded_from_standard_workload OR NOT coalesce(g.counts_toward_regular_load,true)
          OR g.component_type='summer_training' THEN 0
          ELSE coalesce((a->>'assigned_component_hours')::numeric,
            CASE WHEN jsonb_array_length(g.instructors)=1 THEN g.component_hours ELSE 0 END) END) AS hours,
        bool_or(g.pending AND a->>'assigned_component_hours' IS NULL) AS pending,
        count(DISTINCT g.college_id) AS college_span,
        string_agg(DISTINCT cc.name, ' · ') AS colleges_label
      FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.instructors) a
      LEFT JOIN public.faculty_identity_links l ON l.instructor_id=(a->>'instructor_id')::uuid
      LEFT JOIN colleges cc ON cc.id=g.college_id
      WHERE coalesce((a->>'is_active')::boolean,true) GROUP BY 1
    ), versions AS (
      SELECT DISTINCT ON (v.college_id) v.id, v.college_id
      FROM public.schedule_versions v
      JOIN colleges c ON c.id=v.college_id AND c.term_id=v.academic_term_id
      WHERE v.status='published' AND NOT v.disposable_test
      ORDER BY v.college_id, v.created_at DESC, v.id
    ), sessions AS (
      SELECT DISTINCT s.id, s.instructor_id,
        extract(epoch FROM (s.end_time-s.start_time))/3600 AS hours
      FROM public.schedule_sessions s
      JOIN versions v ON v.id=s.schedule_version_id
      WHERE NOT s.replaced_by_split AND s.college_id=v.college_id
    ), scheduled AS (
      SELECT coalesce(l.identity_id, s.instructor_id) AS identity_id, sum(s.hours) AS hours
      FROM sessions s
      LEFT JOIN public.faculty_identity_links l ON l.instructor_id=s.instructor_id
      WHERE s.instructor_id IS NOT NULL GROUP BY 1
    ), directory AS (
      SELECT h.identity_id, h.full_name, h.university_number,
        h.home_college_id, h.home_college_name, h.is_active,
        coalesce(nullif(btrim(h.academic_rank),''),'غير محدد') AS academic_rank,
        coalesce(nullif(btrim(h.employment_type),''),'unknown') AS employment_type,
        h.recorded_quota, h.recorded_release, h.quota,
        nullif(btrim(CASE WHEN position('الحالة الوظيفية: ' in coalesce(i.notes,''))>0
          THEN split_part(split_part(i.notes,'الحالة الوظيفية: ',2),E'\n',1)
          WHEN position('الحالة في الكشف: ' in coalesce(i.notes,''))>0
          THEN split_part(split_part(split_part(i.notes,'الحالة في الكشف: ',2),E'\n',1),'—',1) ELSE '' END),'') AS status_reason
      FROM faculty_private.home_profiles h
      JOIN public.instructors i ON i.id=h.source_instructor_id
      WHERE EXISTS (
        SELECT 1 FROM public.faculty_identity_links l
        JOIN public.instructors li ON li.id=l.instructor_id
        JOIN public.colleges lc ON lc.id=li.college_id
        WHERE l.identity_id=h.identity_id
          AND upper(btrim(coalesce(lc.code,''))) NOT LIKE 'TEST%'
      )
    ), detail AS (
      SELECT d.*, hc.name AS listed_home_college, hc.term_id AS home_term_id,
        w.hours AS assigned_hours, coalesce(w.pending,false) AS load_pending,
        w.colleges_label, sch.hours AS scheduled_hours,
        CASE WHEN d.status_reason IS NOT NULL THEN d.status_reason
          WHEN d.is_active THEN 'متاح' ELSE 'غير متاح' END AS status_label,
        (d.quota IS NULL OR coalesce(w.pending,false)) AS uncertain
      FROM directory d
      LEFT JOIN colleges hc ON hc.id=d.home_college_id
      LEFT JOIN staff_load w ON w.identity_id=d.identity_id
      LEFT JOIN scheduled sch ON sch.identity_id=d.identity_id
      WHERE p_college_id IS NULL OR d.home_college_id=p_college_id
    ), scoped AS (
      SELECT *, (is_active AND listed_home_college IS NOT NULL AND home_term_id IS NOT NULL AND NOT uncertain) AS in_quota_scope
      FROM detail
    )
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'id', identity_id,
        'name', full_name,
        'university_number', university_number,
        'college_id', home_college_id,
        'college', coalesce(listed_home_college, home_college_name),
        'status', status_label,
        'rank', academic_rank,
        'employment_type', employment_type,
        'base_quota', recorded_quota,
        'release_hours', recorded_release,
        'required_hours', CASE WHEN in_quota_scope THEN quota END,
        'assigned_hours', CASE WHEN in_quota_scope THEN coalesce(assigned_hours,0) END,
        'scheduled_hours', scheduled_hours,
        'deficit_hours', CASE WHEN in_quota_scope THEN greatest(0, quota - coalesce(assigned_hours,0)) END,
        'overload_hours', CASE WHEN in_quota_scope THEN greatest(0, coalesce(assigned_hours,0) - quota) END,
        'teaching_colleges', colleges_label,
        'in_quota_scope', in_quota_scope,
        'incomplete_reason', CASE WHEN NOT is_active THEN 'غير نشِط'
          WHEN listed_home_college IS NULL THEN 'الكلية الأصلية غير محسومة'
          WHEN home_term_id IS NULL THEN 'الفصل غير محدد للكلية'
          WHEN quota IS NULL THEN 'النصاب غير مسجل'
          WHEN load_pending THEN 'توزيع التدريس المشترك غير محسوم' END
      ) ORDER BY coalesce(listed_home_college,''), full_name),'[]'::jsonb),
      jsonb_build_object(
        'records', count(*),
        'unique_faculty', count(DISTINCT identity_id),
        'available', count(*) FILTER (WHERE status_label='متاح'),
        'net_quota', coalesce(sum(quota) FILTER (WHERE in_quota_scope),0),
        'assigned_hours', coalesce(sum(coalesce(assigned_hours,0)) FILTER (WHERE in_quota_scope),0),
        'deficit_hours', coalesce(sum(greatest(0, quota - coalesce(assigned_hours,0))) FILTER (WHERE in_quota_scope),0),
        'overload_hours', coalesce(sum(greatest(0, coalesce(assigned_hours,0) - quota)) FILTER (WHERE in_quota_scope),0),
        'incomplete_faculty', count(*) FILTER (WHERE is_active AND listed_home_college IS NOT NULL AND home_term_id IS NOT NULL AND uncertain)
      )
    INTO v_rows, v_totals FROM scoped;

  ELSE
    WITH colleges AS (
      SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid, name text, term_id uuid, term_name text)
    ), versions AS (
      SELECT DISTINCT ON (v.college_id) v.id, v.college_id, v.name, v.updated_at
      FROM public.schedule_versions v
      JOIN colleges c ON c.id=v.college_id AND c.term_id=v.academic_term_id
      WHERE v.status='published' AND NOT v.disposable_test
      ORDER BY v.college_id, v.created_at DESC, v.id
    ), sessions AS (
      SELECT s.id, s.college_id, s.room_id,
        coalesce(p.component_type, s.session_type) AS component,
        extract(epoch FROM (s.end_time-s.start_time))/3600 AS hours
      FROM public.schedule_sessions s
      JOIN versions v ON v.id=s.schedule_version_id
      LEFT JOIN public.plan_course_components p ON p.id=s.plan_course_component_id
      WHERE NOT s.replaced_by_split AND s.college_id=v.college_id
    ), teaching AS (
      SELECT college_id, count(*) AS sessions_count, sum(hours) AS teaching_hours,
        sum(hours) FILTER (WHERE component='theory') AS theory_hours,
        sum(hours) FILTER (WHERE component IN ('practical','lab','clinical','field_training')) AS practical_hours,
        count(*) FILTER (WHERE room_id IS NULL) AS unplaced_sessions,
        count(DISTINCT room_id) AS used_rooms
      FROM sessions GROUP BY college_id
    ), detail AS (
      SELECT c.id, c.name, c.term_name, v.id AS version_id, v.name AS version_name, v.updated_at,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.sessions_count,0) END AS sessions_count,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.teaching_hours,0) END AS teaching_hours,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.theory_hours,0) END AS theory_hours,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.practical_hours,0) END AS practical_hours,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.unplaced_sessions,0) END AS unplaced_sessions,
        CASE WHEN v.id IS NOT NULL THEN coalesce(t.used_rooms,0) END AS used_rooms
      FROM colleges c
      LEFT JOIN versions v ON v.college_id=c.id
      LEFT JOIN teaching t ON t.college_id=c.id
    )
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'college_id', id,
        'college', name,
        'term', term_name,
        'version', version_name,
        'published', version_id IS NOT NULL,
        'version_updated_at', updated_at,
        'sessions_count', sessions_count,
        'teaching_hours', teaching_hours,
        'theory_hours', theory_hours,
        'practical_hours', practical_hours,
        'unplaced_sessions', unplaced_sessions,
        'used_rooms', used_rooms
      ) ORDER BY name),'[]'::jsonb),
      jsonb_build_object(
        'records', count(*),
        'published', count(*) FILTER (WHERE version_id IS NOT NULL),
        'sessions_count', coalesce(sum(sessions_count),0),
        'teaching_hours', coalesce(sum(teaching_hours),0),
        'unplaced_sessions', coalesce(sum(unplaced_sessions),0)
      )
    INTO v_rows, v_totals FROM detail;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'metric', p_metric,
    'year', v_year,
    'term_type', v_type,
    'college_id', p_college_id,
    'generated_at', now(),
    'rows', coalesce(v_rows,'[]'::jsonb),
    'totals', coalesce(v_totals,'{}'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.leadership_metric_details(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leadership_metric_details(text, text, text, uuid) TO authenticated;
