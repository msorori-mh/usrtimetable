BEGIN;
-- Shared (merged) lectures inside one draft timetable.
--
-- A college must be able to rebuild its published timetable with the same
-- shared lectures: one lecture that several cohorts attend together, each
-- cohort keeping its own delivery group and its own teaching assignment.
-- The platform already models exactly that at version level
-- (schedule_version_delivery_private.shared_link_facts): the anchor carries
-- the session, the members are represented by it, the conflict engine and the
-- student timetables expand the anchor to every attending cohort, and the
-- load readers count the lecture once (public.delivery_group_shared_in_published).
-- Until now those facts could only be written by cloning, by the ITCS cutover
-- or by a source revision, so a new draft could not reproduce a published
-- merge of more than two groups, of groups that already have assignments, or
-- of the same lecture filed under different course codes in two plans.
--
-- public.merge_version_shared_lecture writes those facts for one draft only.
-- Nothing global changes: shared_lecture_links, delivery groups, cohorts,
-- headcounts and assignments are untouched, and a published version stays
-- immutable (the existing fact guards still apply). Room capacity is still
-- enforced when the anchor session is placed, on the merged headcount.
-- public.unmerge_version_shared_lecture removes a member before the lecture
-- is scheduled. Regression checks: tests/version-shared-lecture-merge.sql
-- (run in CI by runtime-gates on a disposable PostgreSQL).

CREATE OR REPLACE FUNCTION public.shared_lecture_course_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  -- Same lecture filed under two plans: compare names without spacing,
  -- tatweel, hamza/taa-marbuta/alef-maqsura spelling or the article "ال".
  SELECT regexp_replace(
           regexp_replace(
             translate(' ' || coalesce(p_name, '') || ' ', 'أإآٱةىـ', 'ااااهي'),
             '\s+ال', ' ', 'g'),
           '\s+', '', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.merge_version_shared_lecture(
  p_version_id uuid,
  p_anchor_group_id uuid,
  p_member_group_ids uuid[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v public.schedule_versions%ROWTYPE;
  a record;
  m record;
  v_member uuid;
  v_members uuid[];
  v_cohorts uuid[];
  v_added integer := 0;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'VERSION_SHARED_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_members
  FROM unnest(coalesce(p_member_group_ids, '{}'::uuid[])) x WHERE x IS NOT NULL;
  IF v_members IS NULL OR cardinality(v_members) > 10 OR p_anchor_group_id = ANY(v_members) THEN
    RAISE EXCEPTION 'VERSION_SHARED_INVALID_MEMBERS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v FROM public.schedule_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_college(v_uid, v.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'VERSION_SHARED_DRAFT_ONLY' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);

  -- Every group in the lecture: same college and term as the draft, an active
  -- timetabled theory group of an active cohort, not part of a global merge.
  FOR m IN
    SELECT ids.id AS requested, g.id, g.college_id, g.cohort_id, g.active, g.is_obsolete,
           g.expected_students, g.capacity_limit,
           c.term_id, c.study_system, c.active AS cohort_active,
           k.component_type, k.is_timetabled, k.weekly_contact_hours,
           co.id AS course_id, co.code AS course_code, co.name AS course_name
    FROM unnest(array_prepend(p_anchor_group_id, v_members)) WITH ORDINALITY ids(id, ord)
    LEFT JOIN public.delivery_groups g ON g.id = ids.id
    LEFT JOIN public.academic_cohorts c ON c.id = g.cohort_id
    LEFT JOIN public.plan_course_components k ON k.id = g.component_id
    LEFT JOIN public.plan_courses pc ON pc.id = g.plan_course_id
    LEFT JOIN public.courses co ON co.id = pc.course_id
    ORDER BY ids.ord
  LOOP
    IF m.id IS NULL OR m.college_id IS DISTINCT FROM v.college_id
       OR m.term_id IS DISTINCT FROM v.academic_term_id THEN
      RAISE EXCEPTION 'VERSION_SHARED_GROUP_SCOPE' USING ERRCODE = '23514',
        DETAIL = m.requested::text;
    END IF;
    IF NOT coalesce(m.active, false) OR coalesce(m.is_obsolete, false)
       OR NOT coalesce(m.cohort_active, false) THEN
      RAISE EXCEPTION 'VERSION_SHARED_GROUP_INACTIVE' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF m.component_type IS DISTINCT FROM 'theory' OR NOT coalesce(m.is_timetabled, true)
       OR coalesce(m.weekly_contact_hours, 0) <= 0 OR coalesce(m.expected_students, 0) <= 0
       OR coalesce(m.capacity_limit, 0) <= 0 THEN
      RAISE EXCEPTION 'VERSION_SHARED_THEORY_ONLY' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF EXISTS (SELECT 1 FROM public.shared_lecture_links l
               WHERE l.member_group_id = m.id OR l.anchor_group_id = m.id) THEN
      RAISE EXCEPTION 'VERSION_SHARED_GLOBAL_LINK_EXISTS' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF EXISTS (SELECT 1 FROM public.schedule_sessions s
               WHERE s.schedule_version_id = p_version_id AND s.delivery_group_id = m.id
                 AND NOT coalesce(s.replaced_by_split, false)) THEN
      RAISE EXCEPTION 'VERSION_SHARED_SCHEDULED' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF m.id = p_anchor_group_id THEN
      a := m;
      v_cohorts := ARRAY[m.cohort_id];
      -- No chains: the anchor is not a member of another lecture in this draft.
      IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
                 WHERE l.version_id = p_version_id AND l.member_group_id = m.id) THEN
        RAISE EXCEPTION 'VERSION_SHARED_CHAIN_FORBIDDEN' USING ERRCODE = '23514',
          DETAIL = m.id::text;
      END IF;
      CONTINUE;
    END IF;
    -- A member is the same lecture as the anchor, for another cohort.
    IF m.cohort_id = ANY(v_cohorts) THEN
      RAISE EXCEPTION 'VERSION_SHARED_SAME_COHORT' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    v_cohorts := v_cohorts || m.cohort_id;
    IF m.study_system IS DISTINCT FROM a.study_system
       OR m.weekly_contact_hours IS DISTINCT FROM a.weekly_contact_hours THEN
      RAISE EXCEPTION 'VERSION_SHARED_CONTEXT_MISMATCH' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF NOT (m.course_id = a.course_id
            OR upper(btrim(m.course_code)) = upper(btrim(a.course_code))
            OR public.shared_lecture_course_name_key(m.course_name)
               = public.shared_lecture_course_name_key(a.course_name)) THEN
      RAISE EXCEPTION 'VERSION_SHARED_COURSE_MISMATCH' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
    IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
               WHERE l.version_id = p_version_id
                 AND (l.anchor_group_id = m.id
                      OR (l.member_group_id = m.id AND l.anchor_group_id <> p_anchor_group_id))) THEN
      RAISE EXCEPTION 'VERSION_SHARED_ALREADY_LINKED' USING ERRCODE = '23514',
        DETAIL = m.id::text;
    END IF;
  END LOOP;

  -- Each group needs a version fact for its size: the scoped group fact when
  -- its cohort is in the draft's delivery scope, otherwise a partner fact
  -- taken from the group as it stands now.
  FOR m IN
    SELECT g.id, g.cohort_id, g.expected_students, g.capacity_limit
    FROM public.delivery_groups g
    WHERE g.id = ANY(array_prepend(p_anchor_group_id, v_members))
  LOOP
    IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
               WHERE s.version_id = p_version_id AND s.cohort_id = m.cohort_id) THEN
      IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts f
                     WHERE f.version_id = p_version_id AND f.group_id = m.id) THEN
        RAISE EXCEPTION 'VERSION_GROUP_FACT_MISSING' USING ERRCODE = '23514',
          DETAIL = m.id::text;
      END IF;
    ELSE
      INSERT INTO schedule_version_delivery_private.partner_group_facts(
        capacity_limit, college_id, expected_students, group_id, version_id)
      VALUES (m.capacity_limit, v.college_id, m.expected_students, m.id, p_version_id)
      ON CONFLICT (version_id, group_id) DO NOTHING;
    END IF;
  END LOOP;

  FOREACH v_member IN ARRAY v_members LOOP
    INSERT INTO schedule_version_delivery_private.shared_link_facts(
      anchor_group_id, college_id, member_group_id, version_id)
    VALUES (p_anchor_group_id, v.college_id, v_member, p_version_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_added := v_added + 1; END IF;
  END LOOP;

  SELECT coalesce(sum(coalesce(f.expected_students, pf.expected_students, g.expected_students)), 0)::integer
  INTO v_total
  FROM public.delivery_groups g
  LEFT JOIN schedule_version_delivery_private.group_facts f
    ON f.version_id = p_version_id AND f.group_id = g.id
  LEFT JOIN schedule_version_delivery_private.partner_group_facts pf
    ON pf.version_id = p_version_id AND pf.group_id = g.id
  WHERE g.id = p_anchor_group_id
     OR g.id IN (SELECT l.member_group_id FROM schedule_version_delivery_private.shared_link_facts l
                 WHERE l.version_id = p_version_id AND l.anchor_group_id = p_anchor_group_id);

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'merge_version_shared_lecture', 'schedule_versions', p_version_id, v.college_id,
    jsonb_build_object('anchor_group_id', p_anchor_group_id, 'member_group_ids', to_jsonb(v_members),
      'added', v_added, 'expected_students', v_total, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
    'anchor_group_id', p_anchor_group_id, 'added', v_added, 'expected_students', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmerge_version_shared_lecture(
  p_version_id uuid,
  p_member_group_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v public.schedule_versions%ROWTYPE;
  v_anchor uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'VERSION_SHARED_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.schedule_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_college(v_uid, v.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'VERSION_SHARED_DRAFT_ONLY' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT l.anchor_group_id INTO v_anchor
  FROM schedule_version_delivery_private.shared_link_facts l
  WHERE l.version_id = p_version_id AND l.member_group_id = p_member_group_id;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'VERSION_SHARED_NOT_LINKED' USING ERRCODE = '23514';
  END IF;
  -- The anchor session was placed for the merged headcount; unschedule first.
  IF EXISTS (SELECT 1 FROM public.schedule_sessions s
             WHERE s.schedule_version_id = p_version_id AND s.delivery_group_id = v_anchor
               AND NOT coalesce(s.replaced_by_split, false)) THEN
    RAISE EXCEPTION 'VERSION_SHARED_SCHEDULED' USING ERRCODE = '23514';
  END IF;
  DELETE FROM schedule_version_delivery_private.shared_link_facts l
  WHERE l.version_id = p_version_id AND l.member_group_id = p_member_group_id;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'unmerge_version_shared_lecture', 'schedule_versions', p_version_id, v.college_id,
    jsonb_build_object('anchor_group_id', v_anchor, 'member_group_id', p_member_group_id,
      'reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
    'anchor_group_id', v_anchor, 'member_group_id', p_member_group_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.shared_lecture_course_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_course_name_key(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_version_shared_lecture(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_version_shared_lecture(uuid, uuid, uuid[], text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unmerge_version_shared_lecture(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmerge_version_shared_lecture(uuid, uuid, text) TO authenticated, service_role;
COMMIT;
