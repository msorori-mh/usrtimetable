-- Physical room IDs are shared resources across college-owned versions.
-- Private checker; integration into placement is gated with the transfer release.
CREATE FUNCTION hosting_private.assert_room_slot_free(
 p_version_id uuid, p_room_id uuid, p_day integer,
 p_start time, p_end time, p_exclude_session_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.schedule_versions%ROWTYPE;
 target_term public.academic_terms%ROWTYPE;
BEGIN
 IF p_room_id IS NULL THEN RETURN; END IF;
 IF p_day IS NULL OR p_day NOT BETWEEN 0 AND 6
  OR p_start IS NULL OR p_end IS NULL OR p_start >= p_end THEN
  RAISE EXCEPTION 'HOSTING_SLOT_INVALID' USING ERRCODE = '23514';
 END IF;
 SELECT * INTO target FROM public.schedule_versions WHERE id = p_version_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'HOSTING_VERSION_NOT_FOUND' USING ERRCODE = '23514'; END IF;
 SELECT * INTO target_term FROM public.academic_terms WHERE id = target.academic_term_id;
 IF NOT FOUND OR target_term.start_date IS NULL OR target_term.end_date IS NULL
  OR target_term.start_date > target_term.end_date THEN
  RAISE EXCEPTION 'HOSTING_TERM_DATES_REQUIRED' USING ERRCODE = '23514';
 END IF;

 -- An invalid external calendar must not silently hide an occupied room.
 IF EXISTS (
  SELECT 1 FROM public.schedule_sessions s
  JOIN public.schedule_versions v ON v.id = s.schedule_version_id
  LEFT JOIN public.academic_terms t ON t.id = v.academic_term_id
  WHERE s.room_id = p_room_id AND v.college_id <> target.college_id
   AND (v.status = 'published' OR (v.is_coordination AND v.status IN ('draft','review','approved')))
   AND NOT coalesce(s.replaced_by_split, false)
   AND (t.id IS NULL OR t.start_date IS NULL OR t.end_date IS NULL OR t.start_date > t.end_date)
 ) THEN
  RAISE EXCEPTION 'HOSTING_TERM_DATES_REQUIRED' USING ERRCODE = '23514';
 END IF;

 IF EXISTS (
  SELECT 1 FROM public.schedule_sessions s
  JOIN public.schedule_versions v ON v.id = s.schedule_version_id
  JOIN public.academic_terms t ON t.id = v.academic_term_id
  WHERE s.room_id = p_room_id AND NOT coalesce(s.replaced_by_split, false)
   AND s.day_of_week = p_day AND s.start_time < p_end AND p_start < s.end_time
   AND (
    (v.id = target.id AND s.id IS DISTINCT FROM p_exclude_session_id)
    OR (v.college_id <> target.college_id
     AND (v.status = 'published' OR (v.is_coordination AND v.status IN ('draft','review','approved')))
     AND target_term.start_date <= t.end_date AND t.start_date <= target_term.end_date
     AND greatest(target_term.start_date, t.start_date)
      + ((p_day - extract(dow FROM greatest(target_term.start_date,t.start_date))::integer + 7) % 7)
      <= least(target_term.end_date,t.end_date)
    )
   )
 ) THEN
  -- No external session, instructor or student identifiers cross the tenant boundary.
  RAISE EXCEPTION 'HOSTING_ROOM_TIME_CONFLICT' USING ERRCODE = '23514';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION hosting_private.assert_room_slot_free(uuid,uuid,integer,time,time,uuid)
 FROM PUBLIC, anon, authenticated;
