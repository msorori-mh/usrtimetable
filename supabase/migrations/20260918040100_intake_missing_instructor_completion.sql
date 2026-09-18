BEGIN;
CREATE OR REPLACE FUNCTION public.complete_existing_intake_row(p_source uuid,p_day integer,p_start time,p_end time,p_room uuid,p_instructor uuid DEFAULT NULL,p_allocations jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE r public.existing_schedule_source_rows%ROWTYPE; v public.schedule_versions%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.existing_schedule_source_rows WHERE id=p_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
 SELECT * INTO v FROM public.schedule_versions WHERE id=r.schedule_version_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(),r.college_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF v.id IS NULL OR v.status<>'draft' OR v.college_id<>r.college_id OR v.academic_term_id<>r.term_id OR NOT public.existing_schedule_intake_enabled(r.college_id,r.term_id) THEN RAISE EXCEPTION 'DRAFT_INTAKE_REQUIRED'; END IF;
 SELECT * INTO r FROM public.existing_schedule_source_rows WHERE id=p_source FOR UPDATE;
 IF r.plan_course_id IS NULL OR r.component_id IS NULL THEN RAISE EXCEPTION 'COURSE_DATA_REQUIRED'; END IF;
 IF p_instructor IS NOT NULL THEN
   IF r.schedule_session_id IS NOT NULL OR cardinality(r.instructor_ids)>0 THEN RAISE EXCEPTION 'EXISTING_INSTRUCTOR_CHANGE_FORBIDDEN'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.instructors WHERE id=p_instructor AND college_id=r.college_id AND is_active) THEN RAISE EXCEPTION 'INSTRUCTOR_COLLEGE_MISMATCH'; END IF;
   UPDATE public.existing_schedule_source_rows SET instructor_ids=ARRAY[p_instructor] WHERE id=p_source;
 END IF;
 RETURN public.complete_existing_schedule_source(p_source,p_day,p_start,p_end,p_room,p_allocations);
END $$;
REVOKE ALL ON FUNCTION public.complete_existing_intake_row(uuid,integer,time,time,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_existing_intake_row(uuid,integer,time,time,uuid,uuid,jsonb) TO authenticated;
COMMIT;
