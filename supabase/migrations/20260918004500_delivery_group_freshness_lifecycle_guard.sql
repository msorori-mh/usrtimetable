-- Delivery-group freshness / data-lifecycle guard.
-- Prevents scheduling against groups derived from stale headcounts, room capacities,
-- or room-type requirements. Keeps plan/component/assignment room-type sources aligned.

BEGIN;

CREATE OR REPLACE FUNCTION public.delivery_group_derivation_status(p_group uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_g public.delivery_groups%ROWTYPE;
  v_ac public.academic_cohorts%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_component_room_code text;
  v_assignment_codes text[];
  v_room_type_id uuid;
  v_room_default integer;
  v_capacity integer;
  v_headcount_id uuid;
  v_headcount integer;
  v_offering_id uuid;
  v_override public.scheduling_headcount_overrides%ROWTYPE;
  v_expected_groups integer;
  v_actual_groups integer;
  v_actual_students integer;
  v_bad integer;
  v_base integer;
  v_rem integer;
BEGIN
  SELECT * INTO v_g FROM public.delivery_groups WHERE id=p_group;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','DELIVERY_GROUP_NOT_FOUND');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_view_college(auth.uid(),v_g.college_id) THEN
    RETURN jsonb_build_object('ok',false,'code','FORBIDDEN');
  END IF;
  IF COALESCE(v_g.active,true)=false OR COALESCE(v_g.is_obsolete,false) THEN
    RETURN jsonb_build_object('ok',true,'current',true,'code','SOURCE_INACTIVE_OR_OBSOLETE');
  END IF;

  SELECT * INTO v_ac FROM public.academic_cohorts WHERE id=v_g.cohort_id;
  IF NOT FOUND OR COALESCE(v_ac.active,false)=false THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','COHORT_INACTIVE_OR_MISSING');
  END IF;
  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id=v_g.component_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','COMPONENT_NOT_FOUND');
  END IF;

  SELECT rt.code INTO v_component_room_code
  FROM public.room_types rt
  WHERE rt.id=v_pcc.required_room_type_id AND rt.college_id=v_g.college_id;

  SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type)) ORDER BY lower(btrim(ta.required_room_type)))
    FILTER (WHERE ta.is_active AND NULLIF(btrim(ta.required_room_type),'') IS NOT NULL)
  INTO v_assignment_codes
  FROM public.teaching_assignments ta
  WHERE ta.plan_course_component_id=v_g.component_id
    AND ta.cohort_id=v_g.cohort_id;

  IF COALESCE(cardinality(v_assignment_codes),0)>1 THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','ROOM_TYPE_ASSIGNMENT_CONFLICT','assignment_room_types',to_jsonb(v_assignment_codes));
  END IF;
  IF COALESCE(cardinality(v_assignment_codes),0)=1 THEN
    IF v_component_room_code IS DISTINCT FROM v_assignment_codes[1] THEN
      RETURN jsonb_build_object('ok',false,'current',false,'code','ROOM_TYPE_SOURCE_MISMATCH','component_room_type',v_component_room_code,'assignment_room_type',v_assignment_codes[1]);
    END IF;
    SELECT rt.id,rt.default_capacity INTO v_room_type_id,v_room_default
    FROM public.room_types rt
    WHERE rt.college_id=v_g.college_id AND rt.code=v_assignment_codes[1] AND rt.is_active
    LIMIT 1;
  ELSE
    v_room_type_id:=v_pcc.required_room_type_id;
    SELECT rt.default_capacity INTO v_room_default
    FROM public.room_types rt
    WHERE rt.id=v_room_type_id AND rt.college_id=v_g.college_id AND rt.is_active;
  END IF;

  -- Practical grouping always follows the current room capacity. Legacy practical
  -- explicit_group_size values are deliberately not authoritative.
  IF v_pcc.component_type='practical' THEN
    v_capacity:=COALESCE(public.effective_room_type_capacity(v_g.college_id,v_room_type_id),v_room_default);
  ELSE
    v_capacity:=COALESCE(NULLIF(v_pcc.explicit_group_size,0),public.effective_room_type_capacity(v_g.college_id,v_room_type_id),v_room_default);
  END IF;
  IF v_capacity IS NULL OR v_capacity<=0 THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','GROUP_CAPACITY_MISSING','component_type',v_pcc.component_type);
  END IF;

  SELECT h.id,h.scheduling_headcount INTO v_headcount_id,v_headcount
  FROM public.scheduling_cohort_term_headcounts h
  WHERE h.college_id=v_g.college_id AND h.cohort_id=v_g.cohort_id AND h.term_id=v_ac.term_id
    AND h.approval_status='approved'
  LIMIT 1;
  IF v_headcount_id IS NULL OR v_headcount IS NULL OR v_headcount<=0 THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','SCHEDULING_HEADCOUNT_MISSING');
  END IF;

  v_offering_id:=public.resolve_offering_for_delivery_group(v_g.id);
  SELECT * INTO v_override
  FROM public.scheduling_headcount_overrides o
  WHERE o.headcount_id=v_headcount_id AND o.active AND o.approval_status='approved'
    AND (o.course_offering_id IS NULL OR o.course_offering_id=v_offering_id)
    AND (o.plan_course_component_id IS NULL OR o.plan_course_component_id=v_g.component_id)
  ORDER BY (o.course_offering_id IS NOT NULL)::int + (o.plan_course_component_id IS NOT NULL)::int DESC
  LIMIT 1;
  IF FOUND THEN v_headcount:=v_override.scheduling_headcount; END IF;
  IF v_headcount IS NULL OR v_headcount<=0 THEN
    RETURN jsonb_build_object('ok',false,'current',false,'code','INVALID_SCHEDULING_HEADCOUNT');
  END IF;

  v_expected_groups:=CEIL(v_headcount::numeric/v_capacity::numeric)::integer;
  v_base:=v_headcount/v_expected_groups;
  v_rem:=v_headcount%v_expected_groups;

  SELECT count(*)::integer,COALESCE(sum(dg.expected_students),0)::integer
    INTO v_actual_groups,v_actual_students
  FROM public.delivery_groups dg
  WHERE dg.cohort_id=v_g.cohort_id AND dg.component_id=v_g.component_id
    AND dg.active AND NOT COALESCE(dg.is_obsolete,false);

  SELECT count(*)::integer INTO v_bad
  FROM public.delivery_groups dg
  WHERE dg.cohort_id=v_g.cohort_id AND dg.component_id=v_g.component_id
    AND dg.active AND NOT COALESCE(dg.is_obsolete,false)
    AND (
      dg.group_number IS NULL OR dg.group_number<1 OR dg.group_number>v_expected_groups
      OR dg.capacity_limit IS DISTINCT FROM v_capacity
      OR dg.expected_students IS DISTINCT FROM (v_base + CASE WHEN dg.group_number<=v_rem THEN 1 ELSE 0 END)
    );

  IF v_actual_groups<>v_expected_groups OR v_actual_students<>v_headcount OR v_bad>0 THEN
    RETURN jsonb_build_object(
      'ok',false,'current',false,'code','STALE_DELIVERY_GROUPS_REGENERATE',
      'cohort_id',v_g.cohort_id,'component_id',v_g.component_id,
      'headcount',v_headcount,'capacity',v_capacity,
      'expected_groups',v_expected_groups,'actual_groups',v_actual_groups,
      'actual_students',v_actual_students,'bad_groups',v_bad
    );
  END IF;

  RETURN jsonb_build_object('ok',true,'current',true,'code','CURRENT','headcount',v_headcount,'capacity',v_capacity,'expected_groups',v_expected_groups);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_group_is_current(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((public.delivery_group_derivation_status(p_group)->>'ok')::boolean,false);
$function$;

CREATE OR REPLACE FUNCTION public.sync_component_room_type_from_assignments(p_component_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_pcc public.plan_course_components%ROWTYPE;
  v_codes text[];
  v_code text;
  v_room_id uuid;
  v_changed boolean:=false;
BEGIN
  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id=p_component_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND'); END IF;
  SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type)) ORDER BY lower(btrim(ta.required_room_type)))
    FILTER(WHERE ta.is_active AND NULLIF(btrim(ta.required_room_type),'') IS NOT NULL)
    INTO v_codes
  FROM public.teaching_assignments ta
  WHERE ta.plan_course_component_id=p_component_id;
  IF COALESCE(cardinality(v_codes),0)=0 THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
  IF cardinality(v_codes)>1 THEN
    RAISE EXCEPTION 'ROOM_TYPE_ASSIGNMENT_CONFLICT: %',array_to_string(v_codes,',') USING ERRCODE='23514';
  END IF;
  v_code:=v_codes[1];
  SELECT id INTO v_room_id FROM public.room_types
  WHERE college_id=v_pcc.college_id AND code=v_code AND is_active AND default_capacity>0 LIMIT 1;
  IF v_room_id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_ROOM_TYPE_INVALID: %',v_code USING ERRCODE='23514'; END IF;
  IF v_pcc.required_room_type_id IS DISTINCT FROM v_room_id THEN
    UPDATE public.plan_course_components SET required_room_type_id=v_room_id,updated_at=now() WHERE id=p_component_id;
    v_changed:=true;
  END IF;
  IF v_pcc.component_type='practical' THEN
    UPDATE public.plan_courses SET required_room_type_for_lab=v_code,updated_at=now()
    WHERE id=v_pcc.plan_course_id AND required_room_type_for_lab IS DISTINCT FROM v_code;
  ELSIF v_pcc.component_type IN ('theory','tutorial') THEN
    UPDATE public.plan_courses SET required_room_type_for_lecture=v_code,updated_at=now()
    WHERE id=v_pcc.plan_course_id AND required_room_type_for_lecture IS DISTINCT FROM v_code;
  END IF;
  RETURN jsonb_build_object('ok',true,'changed',v_changed,'room_type',v_code,'room_type_id',v_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_component_room_type_from_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.plan_course_component_id IS NOT NULL THEN PERFORM public.sync_component_room_type_from_assignments(OLD.plan_course_component_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.plan_course_component_id IS NOT NULL THEN PERFORM public.sync_component_room_type_from_assignments(NEW.plan_course_component_id); END IF;
  IF TG_OP='UPDATE' AND OLD.plan_course_component_id IS DISTINCT FROM NEW.plan_course_component_id AND OLD.plan_course_component_id IS NOT NULL THEN
    PERFORM public.sync_component_room_type_from_assignments(OLD.plan_course_component_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ta_sync_component_room_type ON public.teaching_assignments;
CREATE TRIGGER trg_ta_sync_component_room_type
AFTER INSERT OR DELETE OR UPDATE OF required_room_type,is_active,plan_course_component_id
ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.trg_sync_component_room_type_from_assignment();

CREATE OR REPLACE FUNCTION public.enforce_delivery_group_explicit_size()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_limit integer; v_type text;
BEGIN
  IF COALESCE(NEW.active,true) AND NOT COALESCE(NEW.is_obsolete,false) THEN
    SELECT component_type,explicit_group_size INTO v_type,v_limit
    FROM public.plan_course_components WHERE id=NEW.component_id AND college_id=NEW.college_id;
    IF v_type='practical' THEN v_limit:=NULL; END IF;
    IF v_limit IS NOT NULL AND v_limit>0 AND COALESCE(NEW.expected_students,0)>v_limit THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_EXPLICIT_SIZE_EXCEEDED: % > %',NEW.expected_students,v_limit USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operational_delivery_group(p_group uuid)
RETURNS public.delivery_groups
LANGUAGE plpgsql STABLE SET search_path TO '' AS $function$
DECLARE g public.delivery_groups%ROWTYPE; total integer; fresh jsonb;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(g.active,true) AND NOT COALESCE(g.is_obsolete,false) THEN
    fresh:=public.delivery_group_derivation_status(p_group);
    IF COALESCE((fresh->>'ok')::boolean,false)=false THEN
      g.active:=false;
      g.is_obsolete:=true;
      g.group_code:=COALESCE(g.group_code,'') || ' — يحتاج إعادة توليد';
      RETURN g;
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=p_group) THEN
    g.active:=false; g.is_obsolete:=true;
  ELSIF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=p_group) THEN
    SELECT sum(d.expected_students)::integer INTO total FROM public.delivery_groups d
      JOIN public.shared_lecture_group_ids(p_group) m ON m.group_id=d.id;
    g.expected_students:=total;
    g.group_code:=g.group_code || ' — مدمج ضمن النظام نفسه';
  END IF;
  RETURN g;
END;
$function$;

CREATE OR REPLACE FUNCTION public._sb_v2_assignment_guard(p_teaching_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id=v_ta.delivery_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','DELIVERY_GROUP_NOT_FOUND','is_v2',true); END IF;
  IF COALESCE(v_dg.is_obsolete,false) THEN RETURN jsonb_build_object('ok',false,'code','OBSOLETE_DELIVERY_GROUP','is_v2',true); END IF;
  IF COALESCE(v_dg.active,true)=false THEN RETURN jsonb_build_object('ok',false,'code','INACTIVE_DELIVERY_GROUP','is_v2',true); END IF;
  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id=v_dg.component_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND','is_v2',true); END IF;
  IF v_pcc.component_type='summer_training' THEN RETURN jsonb_build_object('ok',false,'code','SUMMER_TRAINING_BLOCKED','is_v2',true); END IF;
  IF v_pcc.component_type='project' AND COALESCE(v_pcc.counts_toward_regular_load,true)=false THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECT_NON_WEEKLY','is_v2',true);
  END IF;
  RETURN jsonb_build_object('ok',true,'is_v2',true,'teaching_assignment_id',v_ta.id,'delivery_group_id',v_dg.id,'component_type',v_pcc.component_type);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_obsolete_duplicate_assignments(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_reactivated integer:=0; v_deactivated integer:=0; v_synced integer:=0; v_remaining integer:=0;
BEGIN
  WITH pairs AS (
    SELECT DISTINCT ON (old_ta.id) old_ta.id AS old_id, live_ta.id AS live_id
    FROM public.teaching_assignments old_ta
    JOIN public.delivery_groups oldg ON oldg.id=old_ta.delivery_group_id AND oldg.cohort_id=p_cohort_id AND oldg.is_obsolete
    JOIN public.delivery_groups liveg ON liveg.cohort_id=oldg.cohort_id AND liveg.component_id=oldg.component_id AND liveg.active AND NOT liveg.is_obsolete
    JOIN public.teaching_assignments live_ta ON live_ta.delivery_group_id=liveg.id
      AND live_ta.instructor_id=old_ta.instructor_id
      AND live_ta.course_offering_id=old_ta.course_offering_id
      AND live_ta.assigned_component_hours IS NOT DISTINCT FROM old_ta.assigned_component_hours
    WHERE old_ta.is_active AND NOT live_ta.is_active
    ORDER BY old_ta.id,live_ta.updated_at DESC,live_ta.id
  ), changed AS (
    UPDATE public.teaching_assignments ta SET is_active=true,updated_at=now()
    FROM pairs p WHERE ta.id=p.live_id RETURNING ta.id
  ) SELECT count(*)::int INTO v_reactivated FROM changed;

  WITH changed AS (
    UPDATE public.teaching_assignments ta SET is_active=false,updated_at=now()
    FROM public.delivery_groups oldg
    WHERE ta.delivery_group_id=oldg.id AND oldg.cohort_id=p_cohort_id AND oldg.is_obsolete AND ta.is_active
      AND EXISTS(
        SELECT 1 FROM public.delivery_groups liveg
        JOIN public.teaching_assignments live_ta ON live_ta.delivery_group_id=liveg.id AND live_ta.is_active
        WHERE liveg.cohort_id=oldg.cohort_id AND liveg.component_id=oldg.component_id AND liveg.active AND NOT liveg.is_obsolete
          AND live_ta.instructor_id=ta.instructor_id AND live_ta.course_offering_id=ta.course_offering_id
          AND live_ta.assigned_component_hours IS NOT DISTINCT FROM ta.assigned_component_hours
      ) RETURNING ta.id
  ) SELECT count(*)::int INTO v_deactivated FROM changed;

  WITH changed AS (
    UPDATE public.teaching_assignments ta
    SET expected_students=(public.operational_delivery_group(ta.delivery_group_id)).expected_students,updated_at=now()
    FROM public.delivery_groups dg
    WHERE ta.delivery_group_id=dg.id AND dg.cohort_id=p_cohort_id AND dg.active AND NOT dg.is_obsolete AND ta.is_active
      AND ta.expected_students IS DISTINCT FROM (public.operational_delivery_group(ta.delivery_group_id)).expected_students
    RETURNING ta.id
  ) SELECT count(*)::int INTO v_synced FROM changed;

  SELECT count(*)::int INTO v_remaining
  FROM public.teaching_assignments ta JOIN public.delivery_groups dg ON dg.id=ta.delivery_group_id
  WHERE dg.cohort_id=p_cohort_id AND dg.is_obsolete AND ta.is_active;

  RETURN jsonb_build_object(
    'reactivated_matching_survivor_assignments',v_reactivated,
    'deactivated_duplicate_assignments',v_deactivated,
    'synced_assignment_headcounts',v_synced,
    'obsolete_active_assignments_remaining',v_remaining
  );
END;
$function$;

-- Preserve the original generator as a private core exactly once.
DO $do$
BEGIN
  IF to_regprocedure('public._generate_cohort_delivery_groups_core_20260918(uuid)') IS NULL THEN
    ALTER FUNCTION public.generate_cohort_delivery_groups(uuid) RENAME TO _generate_cohort_delivery_groups_core_20260918;
  END IF;
END
$do$;

-- Patch core capacity semantics: practical follows room capacity; explicit sizes
-- may override non-practical components (including the large lecture hall case).
DO $do$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public._generate_cohort_delivery_groups_core_20260918(uuid)'::regprocedure);
  IF position('v_capacity := r.room_default_capacity;' in v_def)>0 THEN
    v_def:=replace(v_def,'v_capacity := r.room_default_capacity;',
      'v_capacity := CASE WHEN r.component_type = ''practical'' THEN r.room_default_capacity ELSE COALESCE(NULLIF(r.explicit_group_size,0), r.room_default_capacity) END;');
    EXECUTE v_def;
  ELSIF position('v_capacity := CASE WHEN r.component_type = ''practical''' in v_def)=0 THEN
    RAISE EXCEPTION 'GENERATOR_CAPACITY_PATCH_ANCHOR_NOT_FOUND';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.generate_cohort_delivery_groups(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_component record;
  v_result jsonb;
  v_reconcile jsonb;
  v_reviews jsonb:='[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id=p_cohort_id;
  IF NOT FOUND OR NOT public.can_manage_college(v_uid,v_cohort.college_id) THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  FOR v_component IN
    SELECT DISTINCT pcc.id
    FROM public.course_offerings co
    JOIN public.plan_course_components pcc ON pcc.plan_course_id=co.plan_course_id AND pcc.college_id=co.college_id
    WHERE co.college_id=v_cohort.college_id AND co.term_id=v_cohort.term_id
      AND co.program_id=v_cohort.program_id AND co.level_id=v_cohort.level_id
      AND co.study_system=v_cohort.study_system AND co.is_active
  LOOP
    PERFORM public.sync_component_room_type_from_assignments(v_component.id);
  END LOOP;

  v_result:=public._generate_cohort_delivery_groups_core_20260918(p_cohort_id);
  v_reconcile:=public.reconcile_obsolete_duplicate_assignments(p_cohort_id);

  IF EXISTS(
    SELECT 1 FROM public.delivery_groups dg
    WHERE dg.cohort_id=p_cohort_id AND dg.active AND NOT dg.is_obsolete
      AND NOT public.delivery_group_is_current(dg.id)
  ) THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_REGENERATION_POSTCHECK_FAILED' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code','OBSOLETE_GROUP_ASSIGNMENT_REVIEW_REQUIRED',
    'delivery_group_id',dg.id,'teaching_assignment_id',ta.id,'instructor_id',ta.instructor_id,
    'message','obsolete delivery group still has an active assignment; manual assignment review required'
  )),'[]'::jsonb)
  INTO v_reviews
  FROM public.teaching_assignments ta JOIN public.delivery_groups dg ON dg.id=ta.delivery_group_id
  WHERE dg.cohort_id=p_cohort_id AND dg.is_obsolete AND ta.is_active;

  v_result:=jsonb_set(v_result,'{warnings}',COALESCE(v_result->'warnings','[]'::jsonb)||v_reviews,true);
  v_result:=jsonb_set(v_result,'{assignment_reconciliation}',v_reconcile,true);
  RETURN v_result;
END;
$function$;

-- Patch work-item RPC idempotently.
DO $do$
DECLARE v_def text; v_anchor text; v_replacement text;
BEGIN
  v_def:=pg_get_functiondef('public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure);

  IF position('''expected_students'', COALESCE(ta.expected_students, dg.expected_students, 0),' in v_def)>0 THEN
    v_def:=replace(v_def,'''expected_students'', COALESCE(ta.expected_students, dg.expected_students, 0),','''expected_students'', COALESCE(dg.expected_students, 0),');
  END IF;

  IF position('NOT public.delivery_group_is_current(dg.id) THEN ''blocked''' in v_def)=0 THEN
    v_def:=replace(v_def,E'CASE\n          WHEN COALESCE(ta.is_active, true) = false THEN ''blocked''',E'CASE\n          WHEN NOT public.delivery_group_is_current(dg.id) THEN ''blocked''\n          WHEN COALESCE(ta.is_active, true) = false THEN ''blocked''');
  END IF;
  IF position('المجموعات قديمة: تغيّر عدد الطلاب أو سعة/نوع القاعة.' in v_def)=0 THEN
    IF position('NOT public.delivery_group_is_current(dg.id) THEN ''STALE_DELIVERY_GROUPS_REGENERATE''' in v_def)>0 THEN
      v_def:=replace(v_def,'''STALE_DELIVERY_GROUPS_REGENERATE''','''المجموعات قديمة: تغيّر عدد الطلاب أو سعة/نوع القاعة. أعد توليد مجموعات المحاضرات والمعامل قبل الجدولة.''');
    ELSE
      v_def:=replace(v_def,E'CASE\n          WHEN COALESCE(ta.is_active, true) = false THEN ''INACTIVE_ASSIGNMENT''',E'CASE\n          WHEN NOT public.delivery_group_is_current(dg.id) THEN ''المجموعات قديمة: تغيّر عدد الطلاب أو سعة/نوع القاعة. أعد توليد مجموعات المحاضرات والمعامل قبل الجدولة.''\n          WHEN COALESCE(ta.is_active, true) = false THEN ''INACTIVE_ASSIGNMENT''');
    END IF;
  END IF;
  IF position('NOT public.delivery_group_is_current(dg.id) THEN false' in v_def)=0 THEN
    v_def:=replace(v_def,E'CASE\n          WHEN COALESCE(ta.is_active, true) = false THEN false',E'CASE\n          WHEN NOT public.delivery_group_is_current(dg.id) THEN false\n          WHEN COALESCE(ta.is_active, true) = false THEN false');
  END IF;

  IF position('SCHEDULE_VERSION_CONTAINS_STALE_DELIVERY_GROUPS' in v_def)=0 THEN
    v_anchor:=E'  IF NOT public.can_view_college(v_uid, v_version.college_id) THEN\n    RAISE EXCEPTION ''insufficient_privilege'' USING ERRCODE = ''42501'';\n  END IF;';
    IF position(v_anchor in v_def)=0 THEN RAISE EXCEPTION 'WORK_ITEMS_STALE_VERSION_GUARD_ANCHOR_NOT_FOUND'; END IF;
    v_replacement:=v_anchor || E'\n\n  IF EXISTS (\n    SELECT 1\n    FROM public.schedule_sessions ss\n    JOIN public.delivery_groups raw_dg ON raw_dg.id=ss.delivery_group_id\n    WHERE ss.schedule_version_id=p_schedule_version_id\n      AND (COALESCE(raw_dg.active,true)=false OR COALESCE(raw_dg.is_obsolete,false) OR NOT public.delivery_group_is_current(raw_dg.id))\n  ) THEN\n    RETURN jsonb_build_object(\n      ''ok'',false,\n      ''code'',''SCHEDULE_VERSION_CONTAINS_STALE_DELIVERY_GROUPS'',\n      ''message_ar'',''نسخة الجدول تحتوي جلسات مرتبطة بمجموعات تدريس قديمة. أنشئ مسودة جديدة أو احذف الجلسات القديمة بعد إعادة توليد المجموعات.'',\n      ''schedule_version_id'',p_schedule_version_id,\n      ''college_id'',v_version.college_id,\n      ''academic_term_id'',v_version.academic_term_id,\n      ''version_status'',v_version.status,\n      ''version_updated_at'',v_version.updated_at,\n      ''rows'',''[]''::jsonb,\n      ''can_manage'',public.can_manage_college(v_uid,v_version.college_id)\n    );\n  END IF;';
    v_def:=replace(v_def,v_anchor,v_replacement);
  END IF;
  EXECUTE v_def;
END
$do$;

-- Session creation must use the operational group headcount, not a stale copy on the assignment.
DO $do$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public.create_schedule_session_from_assignment_v2(uuid,uuid,integer,time without time zone,time without time zone,uuid,timestamp with time zone,text)'::regprocedure);
  IF position('COALESCE(v_ta.expected_students, v_dg.expected_students, 0)' in v_def)>0 THEN
    v_def:=replace(v_def,'COALESCE(v_ta.expected_students, v_dg.expected_students, 0)','COALESCE(v_dg.expected_students, 0)');
    EXECUTE v_def;
  END IF;
END
$do$;

-- Existing stale sessions remain deletable, but cannot be inserted or moved/re-saved.
CREATE OR REPLACE FUNCTION public.guard_schedule_session_current_delivery_group()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_source public.delivery_groups%ROWTYPE; v_fresh jsonb;
BEGIN
  IF NEW.delivery_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_source FROM public.delivery_groups WHERE id=NEW.delivery_group_id;
  IF NOT FOUND OR COALESCE(v_source.active,true)=false OR COALESCE(v_source.is_obsolete,false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  v_fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id);
  IF COALESCE((v_fresh->>'ok')::boolean,false)=false THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE' USING ERRCODE='23514',DETAIL=v_fresh::text;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_schedule_session_current_delivery_group ON public.schedule_sessions;
CREATE TRIGGER trg_schedule_session_current_delivery_group
BEFORE INSERT OR UPDATE ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_session_current_delivery_group();

-- Restrict internal/bypass functions; expose only safe public entry points.
REVOKE ALL ON FUNCTION public._generate_cohort_delivery_groups_core_20260918(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._generate_cohort_delivery_groups_core_20260918(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sync_component_room_type_from_assignments(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_component_room_type_from_assignments(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_obsolete_duplicate_assignments(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_obsolete_duplicate_assignments(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_sync_component_room_type_from_assignment() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_schedule_session_current_delivery_group() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.generate_cohort_delivery_groups(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_cohort_delivery_groups(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.delivery_group_derivation_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delivery_group_derivation_status(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.delivery_group_is_current(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delivery_group_is_current(uuid) TO authenticated,service_role;

COMMIT;
