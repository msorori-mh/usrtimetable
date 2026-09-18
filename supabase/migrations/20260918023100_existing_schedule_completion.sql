BEGIN;
CREATE INDEX IF NOT EXISTS existing_schedule_source_session_idx ON public.existing_schedule_source_rows(schedule_session_id);
CREATE OR REPLACE FUNCTION public.complete_existing_schedule_source(p_source uuid,p_day integer,p_start time,p_end time,p_room uuid,p_allocations jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE r public.existing_schedule_source_rows%ROWTYPE; v public.schedule_versions%ROWTYPE; a record; pending_split boolean;
BEGIN
 SELECT * INTO r FROM public.existing_schedule_source_rows WHERE id=p_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
 SELECT * INTO v FROM public.schedule_versions WHERE id=r.schedule_version_id FOR UPDATE;
 IF v.id IS NULL OR v.college_id<>r.college_id OR v.academic_term_id<>r.term_id OR v.status<>'draft' THEN RAISE EXCEPTION 'DRAFT_REQUIRED'; END IF;
 IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(),r.college_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT public.existing_schedule_intake_enabled(r.college_id,r.term_id) THEN RAISE EXCEPTION 'INTAKE_DISABLED'; END IF;
 SELECT * INTO r FROM public.existing_schedule_source_rows WHERE id=p_source FOR UPDATE;
 IF r.schedule_session_id IS NOT NULL AND (p_day IS DISTINCT FROM r.day_of_week OR p_start IS DISTINCT FROM r.start_time OR p_end IS DISTINCT FROM r.end_time) THEN RAISE EXCEPTION 'USE_TIMETABLE_EDITOR_FOR_SCHEDULED_TIME'; END IF;
 IF p_day IS NULL OR p_day NOT BETWEEN 0 AND 6 OR ((p_start IS NULL)<>(p_end IS NULL)) OR p_end<=p_start THEN RAISE EXCEPTION 'INVALID_SESSION_TIME'; END IF;
 IF p_room IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rooms WHERE id=p_room AND college_id=r.college_id AND is_active) THEN RAISE EXCEPTION 'ROOM_COLLEGE_MISMATCH'; END IF;
 IF r.shared_member AND p_room IS DISTINCT FROM r.room_id THEN RAISE EXCEPTION 'SHARED_SESSION_REVIEW_REQUIRED'; END IF;
 IF r.schedule_session_id IS NOT NULL AND p_room IS DISTINCT FROM r.room_id THEN
   UPDATE public.schedule_sessions SET room_id=p_room WHERE id=r.schedule_session_id AND college_id=r.college_id;
 END IF;
 IF p_allocations IS NOT NULL THEN
   IF jsonb_typeof(p_allocations)<>'object' THEN RAISE EXCEPTION 'INVALID_ALLOCATIONS'; END IF;
   FOR a IN SELECT key,value FROM jsonb_each_text(p_allocations) LOOP
     IF NOT a.key::uuid=ANY(r.instructor_ids) OR a.value::numeric<=0 THEN RAISE EXCEPTION 'INVALID_INSTRUCTOR_ALLOCATION'; END IF;
     UPDATE public.teaching_assignments SET assigned_component_hours=a.value::numeric
       WHERE delivery_group_id=r.delivery_group_id AND college_id=r.college_id AND instructor_id=a.key::uuid AND is_active;
     IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
   END LOOP;
 END IF;
 SELECT count(*)>1 AND bool_or(assigned_component_hours IS NULL) INTO pending_split
 FROM public.teaching_assignments WHERE delivery_group_id=r.delivery_group_id AND is_active;
 UPDATE public.existing_schedule_source_rows SET day_of_week=p_day,start_time=p_start,end_time=p_end,room_id=p_room,
   pending_reasons=CASE WHEN p_start IS NULL OR p_end IS NULL THEN ARRAY['وقت المحاضرة بانتظار الاستكمال'] ELSE ARRAY[]::text[] END ||
     CASE WHEN p_room IS NULL THEN ARRAY['قاعة بانتظار التحديد'] ELSE ARRAY[]::text[] END ||
     CASE WHEN pending_split THEN ARRAY['توزيع نصاب التدريس المشترك بانتظار الاستكمال'] ELSE ARRAY[]::text[] END,
   updated_at=now() WHERE id=p_source;
 RETURN public.import_existing_schedule_intake(r.schedule_version_id,NULL);
END $$;
REVOKE ALL ON FUNCTION public.complete_existing_schedule_source(uuid,integer,time,time,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_existing_schedule_source(uuid,integer,time,time,uuid,jsonb) TO authenticated;
COMMIT;
