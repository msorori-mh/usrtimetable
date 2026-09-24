DO $ba$
DECLARE
  c_version uuid:='7ee27c18-9c45-4d8b-bd24-a02f747da1bd';
  v public.schedule_versions%ROWTYPE;
  v_linked int; v_phys int; v_pending int; v_shared int; v_conf int; v_md5 text;
BEGIN
  SELECT * INTO v FROM public.schedule_versions WHERE id=c_version;
  IF v.id IS NULL OR v.status<>'draft' THEN RAISE EXCEPTION 'REVISION_NOT_DRAFT'; END IF;

  -- Pending BA rows that are the SAME physical lecture already present in this revision
  -- (identical lecturer, day, time, room and component shape as an existing source row's
  -- session). They become shared-lecture members of that session instead of a duplicate
  -- session or a false conflict. Times, rooms, lecturers and raw source data are untouched.
  CREATE TEMP TABLE _pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (r.id) r.id AS row_id, r.source_id, r.delivery_group_id AS member_group,
         r.teaching_assignment_id AS member_ta,
         a.source_id AS anchor_source_id, a.shared_key, a.delivery_group_id AS anchor_group, s.id AS anchor_session
  FROM public.existing_schedule_source_rows r
  JOIN public.plan_course_components rc ON rc.id=r.component_id
  JOIN public.existing_schedule_source_rows a
    ON a.college_id=r.college_id AND a.term_id=r.term_id AND a.id<>r.id
   AND a.source_id !~ '^BA[0-9]{2}$' AND a.shared_key IS NOT NULL
   AND a.instructor_ids=r.instructor_ids AND a.day_of_week=r.day_of_week
   AND a.start_time=r.start_time AND a.end_time=r.end_time
   AND a.room_id=r.room_id AND a.room_id IS NOT NULL
  JOIN public.plan_course_components ac ON ac.id=a.component_id
   AND ac.component_type=rc.component_type AND ac.weekly_contact_hours=rc.weekly_contact_hours
  JOIN public.schedule_sessions s ON s.schedule_version_id=c_version
   AND s.delivery_group_id=a.delivery_group_id AND s.day_of_week=a.day_of_week
   AND s.start_time=a.start_time AND s.end_time=a.end_time AND s.room_id=a.room_id
   AND s.instructor_id=a.instructor_ids[1]
  WHERE r.college_id=v.college_id AND r.term_id=v.academic_term_id
    AND r.source_id ~ '^BA[0-9]{2}$' AND r.schedule_session_id IS NULL
    AND array_length(r.instructor_ids,1)=1 AND r.delivery_group_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.delivery_group_id=r.delivery_group_id)
  ORDER BY r.id, a.source_id;

  SELECT count(*) INTO v_linked FROM _pairs;
  IF v_linked=0 THEN RAISE EXCEPTION 'NO_SHARED_ANCHOR_FOUND'; END IF;

  -- the member group carries no own teaching assignment: the anchor lecture holds the load
  DELETE FROM public.teaching_assignments t
   WHERE t.id IN (SELECT member_ta FROM _pairs WHERE member_ta IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.teaching_assignment_id=t.id);

  UPDATE public.existing_schedule_source_rows r
     SET shared_key=p.shared_key, schedule_session_id=p.anchor_session, teaching_assignment_id=NULL,
         shared_member=true, status='shared_member', pending_reasons=ARRAY[]::text[],
         notes=coalesce(r.notes||' | ','')||'محاضرة مشتركة مع '||p.anchor_source_id||' — نفس المحاضر والوقت والقاعة؛ لم تُنشأ محاضرة فعلية جديدة'
    FROM _pairs p WHERE r.id=p.row_id;

  INSERT INTO public.shared_lecture_links(college_id,member_group_id,anchor_group_id)
  SELECT v.college_id,p.member_group,p.anchor_group FROM _pairs p
  ON CONFLICT(member_group_id) DO NOTHING;

  SELECT count(*) FILTER (WHERE status='imported'), count(*) FILTER (WHERE status='shared_member'),
         count(*) FILTER (WHERE schedule_session_id IS NULL)
    INTO v_phys,v_shared,v_pending
    FROM public.existing_schedule_source_rows
   WHERE college_id=v.college_id AND term_id=v.academic_term_id AND source_id ~ '^BA[0-9]{2}$';
  IF v_phys+v_shared+v_pending<>29 THEN RAISE EXCEPTION 'RECONCILIATION_DRIFT %/%/%',v_phys,v_shared,v_pending; END IF;

  SELECT count(*) INTO v_conf FROM public.schedule_sessions a JOIN public.schedule_sessions b
    ON b.schedule_version_id=a.schedule_version_id AND a.id<b.id AND a.day_of_week=b.day_of_week
   AND a.start_time<b.end_time AND b.start_time<a.end_time
   WHERE a.schedule_version_id=c_version AND a.instructor_id=b.instructor_id;
  IF v_conf>0 THEN RAISE EXCEPTION 'INSTRUCTOR_CONFLICT_REMAINS %',v_conf; END IF;

  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_md5
    FROM public.schedule_sessions s WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50';
  IF v_md5<>'7e0b7e291e3668c8e30c4ee7fe009878' THEN RAISE EXCEPTION 'PUBLISHED_SOURCE_CHANGED %',v_md5; END IF;

  INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
  VALUES(v.college_id,c_version,'cloned',NULL,'draft',NULL,
    'ربط محاضرات إدارة الأعمال المشتركة بالمحاضرات القائمة نفسها (نفس المحاضر والوقت والقاعة) بدل تكرارها أو اعتبارها تعارضاً',
    jsonb_build_object('event_kind','existing_schedule_shared_members_linked',
      'linked_rows',(SELECT jsonb_agg(jsonb_build_object('source_id',source_id,'anchor',anchor_source_id) ORDER BY source_id) FROM _pairs),
      'source_rows_physical',v_phys,'source_rows_shared_members',v_shared,'source_rows_pending',v_pending,
      'instructor_identity_conflicts',v_conf,'source_sessions_md5',v_md5));
  RAISE NOTICE 'linked=% physical=% shared=% pending=%',v_linked,v_phys,v_shared,v_pending;
END $ba$;