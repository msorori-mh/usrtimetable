-- Import components and their room references atomically with legacy counters.
-- DDL only: existing plan data is repaired separately from verified import manifests.
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
  FOR part IN SELECT * FROM (VALUES
    ('theory', v_theory, v_theory>0, true, 'required_room_type_code_lecture'),
    ('practical', v_practical, v_practical>0, true, 'required_room_type_code_practical'),
    ('tutorial', v_tutorial, v_tutorial>0 AND NOT v_summer, true, 'required_room_type_code_tutorial'),
    ('project', v_project, v_project>0 OR v_grad, false, 'required_room_type_code_project'),
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
  SELECT COALESCE(sum(weekly_contact_hours) FILTER (WHERE component_type IN ('theory','tutorial') AND is_timetabled),0),
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
