-- Stage ITCS-ISO-02d. Install only after 02a, 02b and 02c. A selected
-- schedule version owns its delivery counts; legacy/unscoped versions retain
-- the existing global derivation. No student counts or sessions change here.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.delivery_group_derivation_status(p_group uuid, p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','schedule_version_delivery_private' AS $body$
DECLARE
  g public.delivery_groups%ROWTYPE;
  c public.academic_cohorts%ROWTYPE;
  component public.plan_course_components%ROWTYPE;
  v_college uuid;
  v_headcount integer;
  v_capacity integer;
  v_room_type uuid;
  v_room_default integer;
  v_room_code text;
  v_assignment_codes text[];
  v_count integer;
  v_students integer;
  v_bad integer;
  v_expected integer;
  v_base integer;
  v_rem integer;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version;
  IF g.id IS NULL OR v_college IS NULL OR g.college_id IS DISTINCT FROM v_college THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_GROUP_SCOPE_MISMATCH');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_view_college(auth.uid(),v_college) THEN
    RETURN jsonb_build_object('ok',false,'code','FORBIDDEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
                 WHERE s.version_id=p_version AND s.cohort_id=g.cohort_id) THEN
    RETURN public.delivery_group_derivation_status(p_group);
  END IF;
  IF NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false) THEN
    RETURN jsonb_build_object('ok',true,'current',true,'code','SOURCE_INACTIVE_OR_OBSOLETE');
  END IF;
  SELECT * INTO c FROM public.academic_cohorts WHERE id=g.cohort_id;
  IF c.id IS NULL OR NOT coalesce(c.active,false)
     OR c.term_id IS DISTINCT FROM (SELECT academic_term_id FROM public.schedule_versions WHERE id=p_version) THEN
    RETURN jsonb_build_object('ok',false,'code','COHORT_INACTIVE_OR_MISSING');
  END IF;
  SELECT * INTO component FROM public.plan_course_components WHERE id=g.component_id;
  IF component.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND'); END IF;

  SELECT rt.code INTO v_room_code FROM public.room_types rt
    WHERE rt.id=component.required_room_type_id AND rt.college_id=v_college;
  SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type)) ORDER BY lower(btrim(ta.required_room_type)))
    FILTER (WHERE ta.is_active AND nullif(btrim(ta.required_room_type),'') IS NOT NULL)
  INTO v_assignment_codes FROM public.teaching_assignments ta
  WHERE ta.plan_course_component_id=g.component_id AND ta.cohort_id=g.cohort_id;
  IF coalesce(cardinality(v_assignment_codes),0)>1 THEN
    RETURN jsonb_build_object('ok',false,'code','ROOM_TYPE_ASSIGNMENT_CONFLICT');
  END IF;
  IF coalesce(cardinality(v_assignment_codes),0)=1 THEN
    IF v_room_code IS DISTINCT FROM v_assignment_codes[1] THEN
      RETURN jsonb_build_object('ok',false,'code','ROOM_TYPE_SOURCE_MISMATCH');
    END IF;
    SELECT rt.id,rt.default_capacity INTO v_room_type,v_room_default
    FROM public.room_types rt WHERE rt.college_id=v_college
      AND rt.code=v_assignment_codes[1] AND rt.is_active LIMIT 1;
  ELSE
    v_room_type:=component.required_room_type_id;
    SELECT rt.default_capacity INTO v_room_default FROM public.room_types rt
    WHERE rt.id=v_room_type AND rt.college_id=v_college AND rt.is_active;
  END IF;
  IF component.component_type='practical' THEN
    v_capacity:=coalesce(public.effective_room_type_capacity(v_college,v_room_type),v_room_default);
  ELSE
    v_capacity:=coalesce(nullif(component.explicit_group_size,0),
      public.effective_room_type_capacity(v_college,v_room_type),v_room_default);
  END IF;
  IF v_capacity IS NULL OR v_capacity<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','GROUP_CAPACITY_MISSING');
  END IF;
  SELECT f.scheduling_headcount INTO v_headcount
  FROM schedule_version_delivery_private.cohort_facts f
  WHERE f.version_id=p_version AND f.cohort_id=g.cohort_id;
  IF v_headcount IS NULL OR v_headcount<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_COHORT_FACT_MISSING');
  END IF;
  v_expected:=ceil(v_headcount::numeric/v_capacity::numeric)::integer;
  v_base:=v_headcount/v_expected;
  v_rem:=v_headcount%v_expected;
  SELECT count(*)::integer,coalesce(sum(f.expected_students),0)::integer,
    count(*) FILTER (WHERE raw.id IS NULL OR NOT raw.active OR coalesce(raw.is_obsolete,false)
      OR raw.cohort_id IS DISTINCT FROM g.cohort_id
      OR raw.component_id IS DISTINCT FROM g.component_id
      OR raw.group_number IS NULL OR raw.group_number<1 OR raw.group_number>v_expected
      OR f.group_code IS DISTINCT FROM raw.group_code
      OR f.capacity_limit IS DISTINCT FROM v_capacity
      OR f.expected_students IS DISTINCT FROM
         v_base+CASE WHEN raw.group_number<=v_rem THEN 1 ELSE 0 END)::integer
  INTO v_count,v_students,v_bad
  FROM schedule_version_delivery_private.group_facts f
  LEFT JOIN public.delivery_groups raw ON raw.id=f.group_id
  WHERE f.version_id=p_version AND f.cohort_id=g.cohort_id
    AND raw.component_id=g.component_id;
  IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts f
                 WHERE f.version_id=p_version AND f.group_id=p_group) THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_GROUP_FACT_MISSING');
  END IF;
  IF v_count<>v_expected OR v_students<>v_headcount OR v_bad>0 THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_DELIVERY_GROUPS_REGENERATE',
      'headcount',v_headcount,'capacity',v_capacity,'expected_groups',v_expected,
      'actual_groups',v_count,'actual_students',v_students,'bad_groups',v_bad);
  END IF;
  RETURN jsonb_build_object('ok',true,'current',true,'code','CURRENT',
    'headcount',v_headcount,'capacity',v_capacity,'expected_groups',v_expected);
END;
$body$;

CREATE FUNCTION public.delivery_group_is_current(p_group uuid,p_version uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $body$
 SELECT coalesce((public.delivery_group_derivation_status(p_group,p_version)->>'ok')::boolean,false)
$body$;

CREATE FUNCTION public.operational_delivery_group(p_version uuid,p_group uuid)
RETURNS public.delivery_groups LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','schedule_version_delivery_private' AS $body$
DECLARE g public.delivery_groups%ROWTYPE; v_college uuid; v_total integer; v_fresh jsonb;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  IF g.id IS NULL THEN RETURN NULL; END IF;
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version;
  IF v_college IS NULL OR g.college_id IS DISTINCT FROM v_college
    OR (auth.uid() IS NOT NULL AND NOT public.can_view_college(auth.uid(),v_college)) THEN
    RAISE EXCEPTION 'VERSION_GROUP_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
    WHERE s.version_id=p_version AND s.cohort_id=g.cohort_id)
    AND NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.partner_group_facts f
      WHERE f.version_id=p_version AND f.group_id=p_group)
    AND NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
      WHERE l.version_id=p_version AND (l.anchor_group_id=p_group OR l.member_group_id=p_group)) THEN
    RETURN public.operational_delivery_group(p_group);
  END IF;
  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
     WHERE s.version_id=p_version AND s.cohort_id=g.cohort_id) THEN
    v_fresh:=public.delivery_group_derivation_status(p_group,p_version);
    IF NOT coalesce((v_fresh->>'ok')::boolean,false) THEN
      g.active:=false; g.is_obsolete:=true; RETURN g;
    END IF;
  END IF;
  SELECT coalesce(f.group_code,g.group_code),coalesce(f.expected_students,pf.expected_students,g.expected_students),
    coalesce(f.capacity_limit,pf.capacity_limit,g.capacity_limit)
  INTO g.group_code,g.expected_students,g.capacity_limit
  FROM (SELECT 1) q
  LEFT JOIN schedule_version_delivery_private.group_facts f
    ON f.version_id=p_version AND f.group_id=p_group
  LEFT JOIN schedule_version_delivery_private.partner_group_facts pf
    ON pf.version_id=p_version AND pf.group_id=p_group;
  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
             WHERE l.version_id=p_version AND l.member_group_id=p_group) THEN
    g.active:=false; g.is_obsolete:=true;
  ELSIF EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
                WHERE l.version_id=p_version AND l.anchor_group_id=p_group) THEN
    IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
      LEFT JOIN schedule_version_delivery_private.group_facts f
        ON f.version_id=p_version AND f.group_id=l.member_group_id
      LEFT JOIN schedule_version_delivery_private.partner_group_facts pf
        ON pf.version_id=p_version AND pf.group_id=l.member_group_id
      WHERE l.version_id=p_version AND l.anchor_group_id=p_group
        AND f.group_id IS NULL AND pf.group_id IS NULL) THEN
      RAISE EXCEPTION 'VERSION_SHARED_PARTNER_FACT_MISSING' USING ERRCODE='23514';
    END IF;
    SELECT sum(coalesce(f.expected_students,pf.expected_students))::integer INTO v_total
    FROM schedule_version_delivery_private.shared_link_facts l
    LEFT JOIN schedule_version_delivery_private.group_facts f
      ON f.version_id=p_version AND f.group_id=l.member_group_id
    LEFT JOIN schedule_version_delivery_private.partner_group_facts pf
      ON pf.version_id=p_version AND pf.group_id=l.member_group_id
    WHERE l.version_id=p_version AND l.anchor_group_id=p_group;
    g.expected_students:=g.expected_students+v_total;
    g.group_code:=g.group_code||' — مدمج ضمن النظام نفسه';
  END IF;
  RETURN g;
END;
$body$;

CREATE FUNCTION public._sb_v2_assignment_guard(p_assignment uuid,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $body$
DECLARE a public.teaching_assignments%ROWTYPE; g public.delivery_groups%ROWTYPE;
  component public.plan_course_components%ROWTYPE; fresh jsonb;
BEGIN
  IF p_assignment IS NULL THEN RETURN jsonb_build_object('ok',true,'is_v2',false); END IF;
  SELECT * INTO a FROM public.teaching_assignments WHERE id=p_assignment;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND'); END IF;
  IF a.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok',true,'is_v2',false,'teaching_assignment_id',a.id);
  END IF;
  IF NOT coalesce(a.is_active,true) THEN
    RETURN jsonb_build_object('ok',false,'code','INACTIVE_ASSIGNMENT','is_v2',true);
  END IF;
  fresh:=public.delivery_group_derivation_status(a.delivery_group_id,p_version);
  IF NOT coalesce((fresh->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_DELIVERY_GROUPS_REGENERATE','is_v2',true,'derivation',fresh);
  END IF;
  g:=public.operational_delivery_group(p_version,a.delivery_group_id);
  IF g.id IS NULL OR coalesce(g.is_obsolete,false) OR NOT coalesce(g.active,true) THEN
    RETURN jsonb_build_object('ok',false,'code','OBSOLETE_DELIVERY_GROUP','is_v2',true);
  END IF;
  SELECT * INTO component FROM public.plan_course_components WHERE id=g.component_id;
  IF component.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND','is_v2',true); END IF;
  IF component.component_type='summer_training' THEN
    RETURN jsonb_build_object('ok',false,'code','SUMMER_TRAINING_BLOCKED','is_v2',true);
  END IF;
  IF component.component_type='project' AND NOT coalesce(component.counts_toward_regular_load,true) THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECT_NON_WEEKLY','is_v2',true);
  END IF;
  RETURN jsonb_build_object('ok',true,'is_v2',true,'teaching_assignment_id',a.id,
    'delivery_group_id',g.id,'component_type',component.component_type);
END;
$body$;

CREATE OR REPLACE FUNCTION public.guard_schedule_session_current_delivery_group()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $body$
DECLARE g public.delivery_groups%ROWTYPE; fresh jsonb;
BEGIN
  IF NEW.delivery_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM public.delivery_groups WHERE id=NEW.delivery_group_id;
  IF g.id IS NULL OR NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id,NEW.schedule_version_id);
  IF NOT coalesce((fresh->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE' USING ERRCODE='23514',DETAIL=fresh::text;
  END IF;
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION public.delivery_group_derivation_status(uuid,uuid),
  public.delivery_group_is_current(uuid,uuid),public.operational_delivery_group(uuid,uuid),
  public._sb_v2_assignment_guard(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delivery_group_derivation_status(uuid,uuid),
  public.delivery_group_is_current(uuid,uuid),public.operational_delivery_group(uuid,uuid),
  public._sb_v2_assignment_guard(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_schedule_session_current_delivery_group() FROM PUBLIC,anon,authenticated;
COMMIT;
