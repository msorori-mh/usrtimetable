-- A review proposal is a stored document, not a schedule_version. This lets
-- reviewers inspect the exact proposed timetable while ordinary scheduling
-- guards continue to reject conflicting operational sessions.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE itcs_cutover_private.review_proposal_registry(
 profile text PRIMARY KEY,
 college_id uuid NOT NULL REFERENCES public.colleges(id),
 source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
 source_snapshot text NOT NULL,
 payload jsonb NOT NULL,
 payload_hash text NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT now(),
 CHECK(payload_hash=md5(payload::text))
);
CREATE TABLE itcs_cutover_private.review_proposals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile text NOT NULL UNIQUE REFERENCES itcs_cutover_private.review_proposal_registry(profile),
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 payload_hash text NOT NULL,
 payload jsonb NOT NULL,
 checks_at_save jsonb NOT NULL,
 saved_by uuid NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 CHECK(payload_hash=md5(payload::text))
);
ALTER TABLE itcs_cutover_private.review_proposal_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE itcs_cutover_private.review_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON itcs_cutover_private.review_proposal_registry,itcs_cutover_private.review_proposals FROM PUBLIC,anon,authenticated;

CREATE FUNCTION itcs_cutover_private.review_proposal_checks(p_profile text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH p AS(SELECT * FROM itcs_cutover_private.review_proposal_registry WHERE profile=p_profile),
 s AS(SELECT x->>0 id,x->>16 instructor,(x->>15)::uuid instructor_id,(x->>1)::int AS "day",
     (x->>2)::time start_time,(x->>3)::time end_time,x->>14 course,x->>8 cohort,x->>6 section
   FROM p,jsonb_array_elements(p.payload->'report_data'->'sessions') x),
 clashes AS(SELECT s.*,jsonb_agg(jsonb_build_object('start',b.start_time,'end',b.end_time)
     ORDER BY b.start_time,b.end_time) external_slots
   FROM s CROSS JOIN p JOIN schedule_coordination_private.busy(p.source_version_id) b
   ON b.instructor_id=s.instructor_id AND b.day_of_week=s.day
     AND b.start_time<s.end_time AND s.start_time<b.end_time
   GROUP BY s.id,s.instructor,s.instructor_id,s.day,s.start_time,s.end_time,s.course,s.cohort,s.section)
 SELECT jsonb_build_object('checked_at',now(),'external_conflict_sessions',(SELECT count(*) FROM clashes),
   'external_conflicts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY day,start_time,id) FROM clashes c),'[]'),
   'sessions',(SELECT count(*) FROM s),'hours',(SELECT sum(extract(epoch FROM end_time-start_time)/3600) FROM s),
   'native_schedule_created',false,'publish_ready',false)
$$;
REVOKE ALL ON FUNCTION itcs_cutover_private.review_proposal_checks(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.itcs_review_proposal_get(p_profile text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.review_proposal_registry%ROWTYPE;
 d itcs_cutover_private.review_proposals%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT p FROM itcs_cutover_private.review_proposal_registry WHERE profile=p_profile;
 SELECT * INTO d FROM itcs_cutover_private.review_proposals WHERE profile=p_profile;
 IF NOT public.is_super_admin(auth.uid()) AND
   (d.id IS NULL OR NOT public.can_view_college(auth.uid(),p.college_id)) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('profile',p.profile,'payload',coalesce(d.payload,p.payload),
  'payload_hash',coalesce(d.payload_hash,p.payload_hash),'source_version_id',p.source_version_id,
  'source_snapshot',p.source_snapshot,'saved',d.id IS NOT NULL,'id',d.id,'saved_at',d.saved_at,
  'checks_at_save',d.checks_at_save,'current_checks',itcs_cutover_private.review_proposal_checks(p_profile));
END $$;
REVOKE ALL ON FUNCTION public.itcs_review_proposal_get(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.itcs_review_proposal_get(text) TO authenticated;

CREATE FUNCTION itcs_cutover_private.save_review_proposal(p_stage text,p_version uuid,p_published uuid,
 p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.review_proposal_registry%ROWTYPE;
 d itcs_cutover_private.review_proposals%ROWTYPE; checks jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_stage IS DISTINCT FROM 'save_review_proposal' THEN RAISE EXCEPTION 'REVIEW_PROPOSAL_DRAFT_ONLY'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.review_proposal_registry WHERE profile=p_manifest->>'profile' FOR UPDATE;
 IF NOT FOUND OR p_manifest IS DISTINCT FROM jsonb_build_object('profile',p.profile)
 OR p_version IS DISTINCT FROM p.source_version_id OR p_published IS DISTINCT FROM p.source_version_id
 OR p_manifest_sha IS DISTINCT FROM p.payload_hash OR p_expected_published_snapshot IS DISTINCT FROM p.source_snapshot THEN
  RAISE EXCEPTION 'UNREGISTERED_REVIEW_PROPOSAL' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM itcs_cutover_private.review_proposals WHERE profile=p.profile;
 IF FOUND THEN
  IF d.payload IS DISTINCT FROM p.payload OR d.payload_hash IS DISTINCT FROM p.payload_hash THEN
   RAISE EXCEPTION 'REVIEW_PROPOSAL_DRIFT'; END IF;
  RETURN jsonb_build_object('saved',true,'status','draft','id',d.id,'replayed',true,'native_schedule_created',false);
 END IF;
 PERFORM 1 FROM public.schedule_versions WHERE id=p.source_version_id AND status='published' FOR UPDATE;
 IF NOT FOUND OR public.schedule_version_session_snapshot(p.source_version_id) IS DISTINCT FROM p.source_snapshot THEN
  RAISE EXCEPTION 'REVIEW_PROPOSAL_SOURCE_DRIFT' USING ERRCODE='23514'; END IF;
 checks:=itcs_cutover_private.review_proposal_checks(p.profile);
 IF (checks->>'sessions')::int<>282 OR (checks->>'hours')::numeric<>644
 OR (SELECT count(DISTINCT x->>0) FROM jsonb_array_elements(p.payload->'report_data'->'sessions') x)<>282 THEN
  RAISE EXCEPTION 'REVIEW_PROPOSAL_CONTENT_INVALID'; END IF;
 INSERT INTO itcs_cutover_private.review_proposals(profile,payload_hash,payload,checks_at_save,saved_by)
 VALUES(p.profile,p.payload_hash,p.payload,checks,auth.uid()) RETURNING * INTO d;
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'itcs_review_proposal_saved','itcs_review_proposals',d.id,p.college_id,
   jsonb_build_object('profile',p.profile,'payload_hash',p.payload_hash,'checks',checks));
 RETURN jsonb_build_object('saved',true,'status','draft','id',d.id,'saved_at',d.saved_at,
   'native_schedule_created',false,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.save_review_proposal(text,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 needle text:='  IF p_stage=''rooms'' THEN';
BEGIN
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'REVIEW_PROPOSAL_ENTRYPOINT_DRIFT'; END IF;
 EXECUTE replace(d,needle,
 '  IF p_manifest->>''profile''=''itcs_proposal15_review_20260930'' THEN
    RETURN itcs_cutover_private.save_review_proposal(p_stage,p_version,p_published,p_manifest,p_manifest_sha,p_expected_published_snapshot);
  END IF;
'||needle);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
