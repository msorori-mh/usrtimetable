-- Performance fix for delivery-group freshness lifecycle guard.
-- Keep freshness fail-closed at scheduling boundaries without evaluating it
-- inside every operational delivery-group read.

BEGIN;

CREATE OR REPLACE FUNCTION public.operational_delivery_group(p_group uuid)
RETURNS public.delivery_groups
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  g public.delivery_groups%ROWTYPE;
  total integer;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=p_group) THEN
    g.active := false;
    g.is_obsolete := true;
  ELSIF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=p_group) THEN
    SELECT sum(d.expected_students)::integer INTO total
    FROM public.delivery_groups d
    JOIN public.shared_lecture_group_ids(p_group) m ON m.group_id=d.id;
    g.expected_students := total;
    g.group_code := g.group_code || ' — مدمج ضمن النظام نفسه';
  END IF;

  RETURN g;
END;
$function$;

-- Avoid materializing the full operational_delivery_groups view for every
-- allocation row. Resolve only the requested delivery group.
CREATE OR REPLACE FUNCTION public.compute_delivery_group_allocation(p_delivery_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_hours numeric;
  v_type text;
  v_sum numeric := 0;
  v_count integer := 0;
  v_remaining numeric;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  IF p_delivery_group_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE='check_violation'; END IF;

  v_dg := public.operational_delivery_group(p_delivery_group_id);
  IF v_dg.id IS NULL THEN RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF NOT public.can_view_college(v_uid,v_dg.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;

  SELECT pcc.weekly_contact_hours,pcc.component_type INTO v_hours,v_type
  FROM public.plan_course_components pcc WHERE pcc.id=v_dg.component_id;

  SELECT COALESCE(SUM(ta.assigned_component_hours),0),COUNT(*)::integer INTO v_sum,v_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id=p_delivery_group_id AND ta.is_active=true;

  IF v_count=1 THEN
    SELECT COALESCE(ta.assigned_component_hours,v_hours,0) INTO v_sum
    FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id=p_delivery_group_id AND ta.is_active=true LIMIT 1;
  END IF;

  v_remaining:=GREATEST(0,COALESCE(v_hours,0)-COALESCE(v_sum,0));
  IF v_count=0 THEN v_status:='unassigned';
  ELSIF COALESCE(v_sum,0)>COALESCE(v_hours,0) THEN v_status:='over_allocated';
  ELSIF COALESCE(v_sum,0)<COALESCE(v_hours,0) THEN v_status:='under_allocated';
  ELSE v_status:='fully_allocated'; END IF;

  RETURN jsonb_build_object(
    'delivery_group_id',p_delivery_group_id,
    'component_type',v_type,
    'component_hours',v_hours,
    'assigned_hours_total',v_sum,
    'remaining_hours',v_remaining,
    'assignment_count',v_count,
    'is_co_taught',v_count>1,
    'allocation_status',v_status
  );
END;
$function$;

-- Freshness stays authoritative at the assignment scheduling boundary, while
-- operational group lookup remains lightweight.
CREATE OR REPLACE FUNCTION public._sb_v2_assignment_guard(p_teaching_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_fresh jsonb;
BEGIN
  IF p_teaching_assignment_id IS NULL THEN RETURN jsonb_build_object('ok',true,'is_v2',false); END IF;
  SELECT * INTO v_ta FROM public.teaching_assignments WHERE id=p_teaching_assignment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND'); END IF;
  IF v_ta.delivery_group_id IS NULL THEN RETURN jsonb_build_object('ok',true,'is_v2',false,'teaching_assignment_id',v_ta.id); END IF;
  IF COALESCE(v_ta.is_active,true)=false THEN RETURN jsonb_build_object('ok',false,'code','INACTIVE_ASSIGNMENT','is_v2',true); END IF;

  v_fresh:=public.delivery_group_derivation_status(v_ta.delivery_group_id);
  IF COALESCE((v_fresh->>'ok')::boolean,false)=false THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_DELIVERY_GROUPS_REGENERATE','is_v2',true,'derivation',v_fresh);
  END IF;

  v_dg:=public.operational_delivery_group(v_ta.delivery_group_id);
  IF v_dg.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','DELIVERY_GROUP_NOT_FOUND','is_v2',true); END IF;
  IF COALESCE(v_dg.is_obsolete,false) THEN RETURN jsonb_build_object('ok',false,'code','OBSOLETE_DELIVERY_GROUP','is_v2',true); END IF;
  IF COALESCE(v_dg.active,true)=false THEN RETURN jsonb_build_object('ok',false,'code','INACTIVE_DELIVERY_GROUP','is_v2',true); END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id=v_dg.component_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND','is_v2',true); END IF;
  IF v_pcc.component_type='summer_training' THEN RETURN jsonb_build_object('ok',false,'code','SUMMER_TRAINING_BLOCKED','is_v2',true); END IF;
  IF v_pcc.component_type='project' AND COALESCE(v_pcc.counts_toward_regular_load,true)=false THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECT_NON_WEEKLY','is_v2',true);
  END IF;

  RETURN jsonb_build_object(
    'ok',true,'is_v2',true,
    'teaching_assignment_id',v_ta.id,
    'delivery_group_id',v_dg.id,
    'component_type',v_pcc.component_type
  );
END;
$function$;

-- In the work-items RPC calculate freshness once per group and reuse it in the
-- three status expressions. The preceding lifecycle migration introduced the
-- direct calls; this follow-up is deliberately idempotent.
DO $do$
DECLARE
  d text;
  oldseg text;
  newseg text;
BEGIN
  d:=pg_get_functiondef('public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure);

  IF position('freshness.is_current' in d)>0 THEN
    RETURN;
  END IF;

  oldseg := $x$    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0) AS scheduled_hours,
        COUNT(*)::integer AS session_count
      FROM public.schedule_sessions ss
      WHERE ss.schedule_version_id = p_schedule_version_id
        AND ss.teaching_assignment_id = ta.id
    ) sched
    CROSS JOIN LATERAL (
      SELECT$x$;

  newseg := $x$    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0) AS scheduled_hours,
        COUNT(*)::integer AS session_count
      FROM public.schedule_sessions ss
      WHERE ss.schedule_version_id = p_schedule_version_id
        AND ss.teaching_assignment_id = ta.id
    ) sched
    CROSS JOIN LATERAL (
      SELECT public.delivery_group_is_current(dg.id) AS is_current
      OFFSET 0
    ) freshness
    CROSS JOIN LATERAL (
      SELECT$x$;

  IF position(oldseg in d)=0 THEN
    RAISE EXCEPTION 'LIST_WORK_ITEMS_PERF_PATCH_ANCHOR_NOT_FOUND';
  END IF;

  d:=replace(d,oldseg,newseg);
  d:=replace(d,'NOT public.delivery_group_is_current(dg.id)','NOT freshness.is_current');
  EXECUTE d;
END $do$;

COMMIT;
