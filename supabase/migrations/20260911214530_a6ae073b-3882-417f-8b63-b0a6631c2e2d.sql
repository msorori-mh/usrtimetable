-- Weekly regular project components become schedulable classroom work.
-- Graduation-project supervision (counts_toward_regular_load = false) keeps its
-- non-weekly semantics: explicit_group_size, workload exclusion and scheduling block.
-- Big function bodies are patched textually from their current definition so every
-- unrelated line stays byte-identical; each patch asserts it actually applied.

CREATE OR REPLACE FUNCTION public._import_sync_plan_course_components(p_college uuid, p_plan_course uuid, v jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_theory numeric := COALESCE(NULLIF(v->>'theory_hours', '')::numeric, 0);
  v_practical numeric := COALESCE(NULLIF(v->>'practical_hours', '')::numeric, 0);
  v_tutorial numeric := COALESCE(NULLIF(v->>'tutorial_hours', '')::numeric, 0)
                        + COALESCE(NULLIF(v->>'training_hours', '')::numeric, 0);
  v_project numeric := COALESCE(NULLIF(v->>'project_hours', '')::numeric, 0);
  v_summer boolean := COALESCE(NULLIF(v->>'is_summer_training', '')::boolean, false);
  v_grad boolean := COALESCE(NULLIF(v->>'is_graduation_project', '')::boolean, false);
  part record; preview jsonb; room_id uuid; room_code text; has_preview boolean;
  lecture_hours numeric; lab_hours numeric; lecture_duration numeric; lab_duration numeric;
  candidate numeric;
BEGIN
  -- Internal helper only; the public commit RPC retains actor/college authorization.
  PERFORM 1 FROM public.plan_courses WHERE id=p_plan_course AND college_id=p_college FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_COURSE_SCOPE_MISMATCH' USING ERRCODE='22023'; END IF;
  has_preview := v ? '_plan_component_sync';
  IF has_preview AND jsonb_typeof(v->'_plan_component_sync') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PLAN_COMPONENT_PREVIEW_INVALID' USING ERRCODE='22023';
  END IF;
  -- Regular weekly project hours are ordinary timetabled load; only graduation
  -- projects stay supervision-only.
  FOR part IN SELECT * FROM (VALUES
    ('theory', v_theory, v_theory>0, true, 'required_room_type_code_lecture'),
    ('practical', v_practical, v_practical>0, true, 'required_room_type_code_practical'),
    ('tutorial', v_tutorial, v_tutorial>0 AND NOT v_summer, true, 'required_room_type_code_tutorial'),
    ('project', v_project, v_project>0 OR v_grad, NOT v_grad, 'required_room_type_code_project'),
    ('summer_training', v_tutorial, v_summer, false, NULL)
  ) AS x(kind,hours,included,regular_load,room_field) WHERE included LOOP
    preview := NULL;
    room_id := NULL;
    IF has_preview THEN
      IF (SELECT count(*) FROM jsonb_array_elements(v->'_plan_component_sync') c WHERE c->>'component_type'=part.kind) <> 1 THEN
        RAISE EXCEPTION 'PLAN_COMPONENT_PREVIEW_MISMATCH: %',part.kind USING ERRCODE='22023';
      END IF;
      SELECT c INTO preview FROM jsonb_array_elements(v->'_plan_component_sync') c WHERE c->>'component_type'=part.kind;
      IF (preview->>'weekly_contact_hours')::numeric IS DISTINCT FROM part.hours
        OR (preview->>'is_timetabled')::boolean IS DISTINCT FROM (part.kind<>'summer_training' AND part.hours>0) THEN
        RAISE EXCEPTION 'PLAN_COMPONENT_PREVIEW_MISMATCH: %',part.kind USING ERRCODE='22023';
      END IF;
      room_id := NULLIF(preview->>'required_room_type_id','')::uuid;
    ELSE
      -- Legacy manifests have no resolved payload: resolve an explicit code,
      -- otherwise preserve an existing reference. Never guess a room type.
      room_code := NULLIF(btrim(v->>part.room_field),'');
      IF room_code IS NOT NULL THEN
        SELECT id INTO room_id FROM public.room_types WHERE college_id=p_college AND code=room_code;
        IF room_id IS NULL THEN RAISE EXCEPTION 'PLAN_COMPONENT_ROOM_TYPE_UNKNOWN: %',room_code USING ERRCODE='22023'; END IF;
      ELSE
        SELECT required_room_type_id INTO room_id FROM public.plan_course_components
          WHERE college_id=p_college AND plan_course_id=p_plan_course AND component_type=part.kind;
      END IF;
    END IF;
    IF part.kind='summer_training' OR part.hours<=0 THEN room_id := NULL; END IF;
    IF has_preview AND part.kind<>'summer_training' AND part.hours>0 AND room_id IS NULL THEN
      RAISE EXCEPTION 'PLAN_COMPONENT_ROOM_TYPE_MISSING: %',part.kind USING ERRCODE='22023';
    END IF;
    IF room_id IS NOT NULL THEN
      PERFORM 1 FROM public.room_types WHERE id=room_id AND college_id=p_college AND is_active AND default_capacity>0 FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_COMPONENT_ROOM_TYPE_INVALID: %',part.kind USING ERRCODE='22023'; END IF;
    END IF;
    INSERT INTO public.plan_course_components (
      college_id,plan_course_id,component_type,weekly_contact_hours,required_room_type_id,
      is_timetabled,counts_toward_regular_load,counts_toward_overtime,compensation_mode
    ) VALUES (
      p_college,p_plan_course,part.kind,part.hours,room_id,
      part.kind<>'summer_training' AND part.hours>0,part.regular_load,part.regular_load,
      CASE WHEN part.regular_load THEN 'per_hour' ELSE 'none' END
    ) ON CONFLICT (plan_course_id,component_type) DO UPDATE SET
      weekly_contact_hours=EXCLUDED.weekly_contact_hours,
      required_room_type_id=EXCLUDED.required_room_type_id,
      is_timetabled=EXCLUDED.is_timetabled,
      counts_toward_regular_load=EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime=EXCLUDED.counts_toward_overtime,
      compensation_mode=EXCLUDED.compensation_mode;
  END LOOP;

  -- Preserve the editor's duration preference when it divides the weekly hours.
  -- Regular weekly project hours share the lecture cadence (lecture_hall sessions).
  SELECT COALESCE(sum(weekly_contact_hours) FILTER (
           WHERE (component_type IN ('theory','tutorial')
                  OR (component_type='project' AND COALESCE(counts_toward_regular_load,false)))
             AND is_timetabled),0),
         COALESCE(sum(weekly_contact_hours) FILTER (WHERE component_type='practical' AND is_timetabled),0)
    INTO lecture_hours,lab_hours FROM public.plan_course_components
    WHERE college_id=p_college AND plan_course_id=p_plan_course;
  -- Legacy count-only imports must retain their explicit scheduling pattern.
  IF NOT EXISTS (SELECT 1 FROM public.plan_course_components WHERE college_id=p_college AND plan_course_id=p_plan_course) THEN RETURN; END IF;
  SELECT lecture_session_duration,lab_session_duration INTO lecture_duration,lab_duration
    FROM public.plan_courses WHERE id=p_plan_course AND college_id=p_college;
  FOREACH candidate IN ARRAY ARRAY[lecture_duration,2,3,1] LOOP
    IF candidate>0 AND (lecture_hours<=0 OR mod(lecture_hours,candidate)=0) THEN lecture_duration:=candidate; EXIT; END IF;
  END LOOP;
  IF lecture_duration IS NULL OR lecture_duration<=0 OR (lecture_hours>0 AND mod(lecture_hours,lecture_duration)<>0) THEN
    lecture_duration:=CASE WHEN lecture_hours>0 THEN lecture_hours ELSE 2 END;
  END IF;
  FOREACH candidate IN ARRAY ARRAY[lab_duration,2,3,1] LOOP
    IF candidate>0 AND (lab_hours<=0 OR mod(lab_hours,candidate)=0) THEN lab_duration:=candidate; EXIT; END IF;
  END LOOP;
  IF lab_duration IS NULL OR lab_duration<=0 OR (lab_hours>0 AND mod(lab_hours,lab_duration)<>0) THEN
    lab_duration:=CASE WHEN lab_hours>0 THEN lab_hours ELSE 2 END;
  END IF;
  UPDATE public.plan_courses SET
    lectures_per_week=CASE WHEN lecture_hours>0 THEN round(lecture_hours/lecture_duration)::int ELSE 0 END,
    labs_per_week=CASE WHEN lab_hours>0 THEN round(lab_hours/lab_duration)::int ELSE 0 END,
    lecture_session_duration=lecture_duration,lab_session_duration=lab_duration
    WHERE id=p_plan_course AND college_id=p_college;
END;
$function$;
REVOKE ALL ON FUNCTION public._import_sync_plan_course_components(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._import_sync_plan_course_components(uuid,uuid,jsonb) TO service_role;

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
BEGIN
  IF p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND');
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false, 'teaching_assignment_id', v_ta.id);
  END IF;

  IF COALESCE(v_ta.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_ASSIGNMENT', 'is_v2', true);
  END IF;

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_ta.delivery_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OBSOLETE_DELIVERY_GROUP', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_DELIVERY_GROUP', 'is_v2', true);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'is_v2', true);
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUMMER_TRAINING_BLOCKED', 'is_v2', true);
  END IF;
  -- Only supervision projects are non-weekly; regular weekly project hours schedule normally.
  IF v_pcc.component_type = 'project'
     AND COALESCE(v_pcc.counts_toward_regular_load, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROJECT_NON_WEEKLY', 'is_v2', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_v2', true,
    'teaching_assignment_id', v_ta.id,
    'delivery_group_id', v_dg.id,
    'component_type', v_pcc.component_type
  );
END;
$function$;

CREATE OR REPLACE VIEW public.v_instructor_delivery_workload AS
 SELECT ta.college_id,
    ta.instructor_id,
    i.academic_rank,
    ta.cohort_id,
    ac.term_id,
    sum(
        CASE
            WHEN pcc.component_type = 'summer_training'::text THEN 0::numeric
            WHEN COALESCE(dg.excluded_from_standard_workload, false) OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0::numeric
            WHEN (( SELECT count(*)::integer AS count
               FROM teaching_assignments ta2
              WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.delivery_group_id IS NOT NULL AND ta2.is_active = true)) > 1 THEN COALESCE(ta.assigned_component_hours, 0::numeric)
            ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0::numeric)
        END) AS standard_assigned_hours,
    sum(
        CASE
            WHEN pcc.component_type = 'project'::text AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN
            CASE
                WHEN (( SELECT count(*)::integer AS count
                   FROM teaching_assignments ta2
                  WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.delivery_group_id IS NOT NULL AND ta2.is_active = true)) > 1 THEN COALESCE(ta.assigned_component_hours, 0::numeric)
                ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0::numeric)
            END
            ELSE 0::numeric
        END) AS project_supervision_hours
   FROM teaching_assignments ta
     JOIN instructors i ON i.id = ta.instructor_id
     LEFT JOIN delivery_groups dg ON dg.id = ta.delivery_group_id
     LEFT JOIN plan_course_components pcc ON pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id)
     LEFT JOIN academic_cohorts ac ON ac.id = COALESCE(ta.cohort_id, dg.cohort_id)
  WHERE ta.delivery_group_id IS NOT NULL AND ta.is_active = true
  GROUP BY ta.college_id, ta.instructor_id, i.academic_rank, ta.cohort_id, ac.term_id;

-- Textual patches for the large functions (identity/ownership preserved).
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_pairs text[][];
  i integer;
BEGIN
  -- ensure_ss_college trigger
  v_def := pg_get_functiondef('public.ensure_ss_college()'::regprocedure);
  v_new := replace(v_def, '  pcc_type text;', E'  pcc_type text;\n  pcc_regular boolean;');
  v_new := replace(v_new,
    E'SELECT pcc.component_type INTO pcc_type\n      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;',
    E'SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)\n        INTO pcc_type, pcc_regular\n      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;');
  v_new := replace(v_new,
    E'IF pcc_type = ''project'' THEN',
    E'IF pcc_type = ''project'' AND COALESCE(pcc_regular, true) = false THEN');
  IF v_new = v_def
     OR position('pcc_regular boolean;' in v_new) = 0
     OR position('INTO pcc_type, pcc_regular' in v_new) = 0
     OR position(E'IF pcc_type = ''project'' THEN' in v_new) > 0 THEN
    RAISE EXCEPTION 'PATCH_FAILED: ensure_ss_college';
  END IF;
  EXECUTE v_new;

  -- generate_cohort_delivery_groups
  v_def := pg_get_functiondef('public.generate_cohort_delivery_groups(uuid)'::regprocedure);
  v_new := v_def;
  v_pairs := ARRAY[
    ARRAY[
      E'    IF r.component_type = ''project'' THEN\n      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN\n        CONTINUE;\n      END IF;',
      E'    IF r.component_type = ''project''\n       AND COALESCE(r.counts_toward_regular_load, false) = false THEN\n      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN\n        CONTINUE;\n      END IF;'
    ],
    ARRAY[
      E'    v_excluded := (r.component_type = ''project'')\n      OR (COALESCE(r.counts_toward_regular_load, true) = false);',
      E'    v_excluded := (COALESCE(r.counts_toward_regular_load, true) = false);'
    ],
    ARRAY[
      E'    IF r.component_type = ''project'' THEN\n      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN\n        v_skipped :=',
      E'    IF r.component_type = ''project'' AND COALESCE(r.counts_toward_regular_load, false) = false THEN\n      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN\n        v_skipped :='
    ],
    ARRAY[
      E'      v_groups_obsolete := v_groups_obsolete + 1;\n\n      IF NOT COALESCE(v_row.is_obsolete, false) THEN\n        UPDATE public.delivery_groups\n        SET is_obsolete = true\n        WHERE id = v_row.id;\n      END IF;',
      E'      IF COALESCE(v_row.is_obsolete, false) THEN\n        CONTINUE;\n      END IF;\n\n      v_groups_obsolete := v_groups_obsolete + 1;\n\n      UPDATE public.delivery_groups\n      SET is_obsolete = true\n      WHERE id = v_row.id;'
    ]
  ];
  FOR i IN 1..array_length(v_pairs, 1) LOOP
    IF position(v_pairs[i][1] in v_new) = 0 THEN
      RAISE EXCEPTION 'PATCH_FAILED: generate_cohort_delivery_groups #%', i;
    END IF;
    v_new := replace(v_new, v_pairs[i][1], v_pairs[i][2]);
  END LOOP;
  EXECUTE v_new;

  -- list_schedule_builder_v2_work_items
  v_def := pg_get_functiondef('public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure);
  v_new := v_def;
  v_pairs := ARRAY[
    ARRAY[
      E'''is_project'', (pcc.component_type = ''project''),',
      E'''is_project'', (pcc.component_type = ''project'' AND COALESCE(pcc.counts_toward_regular_load, true) = false),'
    ],
    ARRAY[
      E'WHEN pcc.component_type = ''project'' THEN ''blocked''',
      E'WHEN pcc.component_type = ''project'' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN ''blocked'''
    ],
    ARRAY[
      E'WHEN pcc.component_type = ''project'' THEN ''PROJECT_NON_WEEKLY''',
      E'WHEN pcc.component_type = ''project'' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN ''PROJECT_NON_WEEKLY'''
    ],
    ARRAY[
      E'WHEN pcc.component_type IN (''summer_training'', ''project'') THEN false',
      E'WHEN pcc.component_type = ''summer_training'' THEN false\n          WHEN pcc.component_type = ''project'' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN false'
    ]
  ];
  FOR i IN 1..array_length(v_pairs, 1) LOOP
    IF position(v_pairs[i][1] in v_new) = 0 THEN
      RAISE EXCEPTION 'PATCH_FAILED: list_schedule_builder_v2_work_items #%', i;
    END IF;
    v_new := replace(v_new, v_pairs[i][1], v_pairs[i][2]);
  END LOOP;
  EXECUTE v_new;

  -- preview_instructor_workload_after_assignment
  v_def := pg_get_functiondef('public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)'::regprocedure);
  v_new := v_def;
  v_pairs := ARRAY[
    ARRAY[
      E'  v_is_project := v_pcc.component_type = ''project''\n    OR COALESCE(v_dg.excluded_from_standard_workload, false)\n    OR COALESCE(v_pcc.counts_toward_regular_load, true) = false;',
      E'  v_is_project := COALESCE(v_dg.excluded_from_standard_workload, false)\n    OR COALESCE(v_pcc.counts_toward_regular_load, true) = false;'
    ],
    ARRAY[
      E'        WHEN pcc.component_type = ''project'' OR COALESCE(dg.excluded_from_standard_workload, false)\n          OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0',
      E'        WHEN COALESCE(dg.excluded_from_standard_workload, false)\n          OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0'
    ],
    ARRAY[
      E'        WHEN pcc.component_type = ''project'' THEN\n          CASE WHEN (',
      E'        WHEN pcc.component_type = ''project'' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN\n          CASE WHEN ('
    ]
  ];
  FOR i IN 1..array_length(v_pairs, 1) LOOP
    IF position(v_pairs[i][1] in v_new) = 0 THEN
      RAISE EXCEPTION 'PATCH_FAILED: preview_instructor_workload_after_assignment #%', i;
    END IF;
    v_new := replace(v_new, v_pairs[i][1], v_pairs[i][2]);
  END LOOP;
  EXECUTE v_new;
END
$patch$;