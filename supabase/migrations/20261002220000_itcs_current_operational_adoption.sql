-- Adopt one registered current operational allocation. Registration stores
-- metadata only. Schedule writes require the existing authenticated cutover API.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE itcs_cutover_private.operational_adoption_profiles (
 profile text PRIMARY KEY,
 payload jsonb NOT NULL,
 manifest_sha text NOT NULL UNIQUE,
 immutable_session_snapshot text NOT NULL,
 assignment_snapshot text NOT NULL,
 scope_snapshot text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (profile=payload->>'profile'),
 CHECK (manifest_sha=md5(payload::text))
);
ALTER TABLE itcs_cutover_private.operational_adoption_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON itcs_cutover_private.operational_adoption_profiles FROM PUBLIC,anon,authenticated,service_role;

-- Withdrawal is an audited version decision, not deletion or deactivation of
-- historical assignments. Unregistered/inactive scope rows keep their policy.
CREATE TABLE assignment_version_private.operational_scope_withdrawals (
 assignment_id uuid PRIMARY KEY REFERENCES public.teaching_assignments(id),
 version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
 replaces_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
 adopted_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
 profile text NOT NULL REFERENCES itcs_cutover_private.operational_adoption_profiles(profile),
 manifest_sha text NOT NULL,
 scope_before jsonb NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE assignment_version_private.operational_scope_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON assignment_version_private.operational_scope_withdrawals FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE itcs_cutover_private.operational_adoption_original_defs (
 signature text PRIMARY KEY, definition text NOT NULL, installed_hash text
);
REVOKE ALL ON itcs_cutover_private.operational_adoption_original_defs FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO itcs_cutover_private.operational_adoption_original_defs(signature,definition)
SELECT s,pg_get_functiondef(s::regprocedure) FROM unnest(ARRAY[
 'public.version_effective_assignments(uuid)',
 'assignment_version_private.new_side_wins(uuid)',
 'public.guard_session_version_scoped_assignment()',
 'public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)']) s;

DO $patch$
DECLARE d text; needle text; replacement text;
BEGIN
 d:=pg_get_functiondef('assignment_version_private.new_side_wins(uuid)'::regprocedure);
 needle:='WHERE s.assignment_id=p_new AND assignment_version_private.is_promoted(s.version_id)';
 replacement:='WHERE s.assignment_id=p_new AND assignment_version_private.is_promoted(s.version_id)
   AND NOT EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals withdrawn
     WHERE withdrawn.assignment_id=s.assignment_id AND withdrawn.version_id=s.version_id)';
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PROMOTION_POLICY_DRIFT'; END IF;
 EXECUTE replace(d,needle,replacement);

 d:=pg_get_functiondef('public.version_effective_assignments(uuid)'::regprocedure);
 needle:='WHERE ta.is_active AND CASE';
 replacement:='WHERE ta.is_active
  AND NOT EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals withdrawn
    WHERE withdrawn.assignment_id=ta.id)
  AND CASE';
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_EFFECTIVE_POLICY_DRIFT'; END IF;
 d:=replace(d,needle,replacement);
 needle:='WHERE s.replaces_assignment_id=ta.id AND (';
 replacement:='WHERE s.replaces_assignment_id=ta.id
   AND NOT EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals withdrawn
     WHERE withdrawn.assignment_id=s.assignment_id AND withdrawn.version_id=s.version_id)
   AND (';
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_ROOT_POLICY_DRIFT'; END IF;
 EXECUTE replace(d,needle,replacement);

 d:=pg_get_functiondef('public.guard_session_version_scoped_assignment()'::regprocedure);
 needle:=E'BEGIN\n';
 IF position(needle IN d)=0 THEN RAISE EXCEPTION 'OPERATIONAL_ADOPTION_SESSION_GUARD_DRIFT'; END IF;
 d:=overlay(d placing needle||'  IF EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals withdrawn
    WHERE withdrawn.assignment_id=NEW.teaching_assignment_id) THEN
    RAISE EXCEPTION ''WITHDRAWN_VERSION_SCOPED_ASSIGNMENT'' USING ERRCODE=''23514'';
  END IF;
' from position(needle IN d) for length(needle));
 EXECUTE d;
END $patch$;

CREATE FUNCTION itcs_cutover_private.operational_adoption_assignment_snapshot(p_profile text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text)
 FROM public.teaching_assignments a
 WHERE a.id IN (
  SELECT (x->>'old_assignment_id')::uuid
  FROM itcs_cutover_private.operational_adoption_profiles p,jsonb_array_elements(p.payload->'sessions') x
  WHERE p.profile=p_profile
  UNION
  SELECT (x->'new'->>'assignment_id')::uuid
  FROM itcs_cutover_private.operational_adoption_profiles p,jsonb_array_elements(p.payload->'sessions') x
  WHERE p.profile=p_profile
  UNION
  SELECT s.assignment_id FROM assignment_version_private.scope s
  JOIN itcs_cutover_private.operational_adoption_profiles p ON p.profile=p_profile
  WHERE s.version_id=(p.payload->>'version_id')::uuid OR s.assignment_id IN
    (SELECT (x->>'assignment_id')::uuid FROM jsonb_array_elements(p.payload->'promoted_reuses') x)
  UNION
  SELECT s.replaces_assignment_id FROM assignment_version_private.scope s
  JOIN itcs_cutover_private.operational_adoption_profiles p ON p.profile=p_profile
  WHERE s.version_id=(p.payload->>'version_id')::uuid OR s.assignment_id IN
    (SELECT (x->>'assignment_id')::uuid FROM jsonb_array_elements(p.payload->'promoted_reuses') x))
$$;
CREATE FUNCTION itcs_cutover_private.operational_adoption_scope_snapshot(p_profile text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.assignment_id),'[]'::jsonb)::text)
 FROM assignment_version_private.scope s
 JOIN itcs_cutover_private.operational_adoption_profiles p ON p.profile=p_profile
 WHERE s.version_id=(p.payload->>'version_id')::uuid OR s.assignment_id IN
  (SELECT (x->>'assignment_id')::uuid FROM jsonb_array_elements(p.payload->'promoted_reuses') x)
$$;
CREATE FUNCTION itcs_cutover_private.operational_adoption_immutable_snapshot(p_version uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(coalesce(jsonb_agg(to_jsonb(s)-ARRAY['teaching_assignment_id','instructor_id',
  'day_of_week','start_time','end_time','room_id','updated_at'] ORDER BY s.id),'[]'::jsonb)::text)
 FROM public.schedule_sessions s WHERE s.schedule_version_id=p_version
$$;

CREATE FUNCTION itcs_cutover_private.assert_operational_adoption_history(p_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.operational_adoption_profiles%ROWTYPE; h jsonb; n integer; snap text;
BEGIN
 SELECT * INTO STRICT p FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=p_profile;
 FOR h IN SELECT x FROM jsonb_array_elements(p.payload->'history') x ORDER BY x->>'version_id' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(h->>'version_id',9174));
  PERFORM 1 FROM public.schedule_versions WHERE id=(h->>'version_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_ADOPTION_HISTORY_DRIFT'; END IF;
  SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO n,snap
  FROM public.schedule_sessions s WHERE schedule_version_id=(h->>'version_id')::uuid;
  IF n IS DISTINCT FROM (h->>'sessions')::integer OR snap IS DISTINCT FROM h->>'full_snapshot'
   OR public.schedule_version_session_snapshot((h->>'version_id')::uuid) IS DISTINCT FROM h->>'snapshot' THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_HISTORY_DRIFT' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION itcs_cutover_private.assert_operational_adoption_reference(p_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.operational_adoption_profiles%ROWTYPE; loop_item jsonb;
BEGIN
 SELECT * INTO STRICT p FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=p_profile;
 IF itcs_cutover_private.operational_adoption_assignment_snapshot(p_profile) IS DISTINCT FROM p.assignment_snapshot
  OR itcs_cutover_private.operational_adoption_scope_snapshot(p_profile) IS DISTINCT FROM p.scope_snapshot THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_OPERATIONAL_REFERENCE_DRIFT' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(p.payload->'preserved_inactive_scope_ids')<>(p.payload->'counts'->>'preserved_inactive_scopes')::integer
  OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.payload->'preserved_inactive_scope_ids') inactive_id
    LEFT JOIN public.teaching_assignments a ON a.id=inactive_id::uuid
    LEFT JOIN assignment_version_private.scope original ON original.assignment_id=a.id
    WHERE a.id IS NULL OR a.is_active IS DISTINCT FROM false
      OR original.version_id IS DISTINCT FROM (p.payload->>'version_id')::uuid) THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_OPERATIONAL_REFERENCE_DRIFT' USING ERRCODE='23514'; END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(p.payload->'sessions') x
  WHERE (SELECT count(*) FROM public.teaching_assignments a
    WHERE a.delivery_group_id=(x->>'delivery_group_id')::uuid AND a.is_active
      AND assignment_version_private.is_counted(a.id))<>1
  OR NOT EXISTS (SELECT 1 FROM public.teaching_assignments a
    JOIN public.course_offerings o ON o.id=a.course_offering_id
    JOIN public.instructors i ON i.id=a.instructor_id
    WHERE a.id=(x->'new'->>'assignment_id')::uuid AND a.is_active
     AND assignment_version_private.is_counted(a.id)
     AND a.college_id=(p.payload->>'college_id')::uuid AND o.term_id=(p.payload->>'term_id')::uuid
     AND a.delivery_group_id=(x->>'delivery_group_id')::uuid
     AND a.instructor_id=(x->'new'->>'instructor_id')::uuid
     AND a.updated_at=(x->>'expected_assignment_updated_at')::timestamptz
     AND i.is_active AND i.availability_status='available'
     AND coalesce(a.assigned_component_hours,a.weekly_hours)=(x->>'hours')::numeric)) THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_OPERATIONAL_REFERENCE_DRIFT' USING ERRCODE='23514'; END IF;
 FOR loop_item IN SELECT t FROM jsonb_array_elements(p.payload->'promoted_reuses') t LOOP
  IF NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
    JOIN assignment_version_private.promotions promoted ON promoted.version_id=s.version_id
    JOIN public.schedule_versions source ON source.id=s.version_id
    WHERE s.assignment_id=(loop_item->>'assignment_id')::uuid AND s.version_id=(loop_item->>'scope_version_id')::uuid
     AND source.college_id=(p.payload->>'college_id')::uuid
     AND source.academic_term_id=(p.payload->>'term_id')::uuid) THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PROMOTED_REFERENCE_DRIFT' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR loop_item IN SELECT t FROM jsonb_array_elements(p.payload->'foreign_approvals') t LOOP
  IF NOT EXISTS (SELECT 1 FROM public.faculty_teaching_requests r
    JOIN public.faculty_identity_links l ON l.instructor_id=r.instructor_id AND l.identity_id=r.identity_id
    JOIN faculty_private.home_profiles h ON h.identity_id=r.identity_id AND h.is_active
    WHERE r.id=(loop_item->>'id')::uuid AND r.assignment_id=(loop_item->>'assignment_id')::uuid AND r.status='approved'
     AND r.identity_id=(loop_item->>'identity_id')::uuid AND r.instructor_id=(loop_item->>'instructor_id')::uuid
     AND r.college_id=(loop_item->>'college_id')::uuid AND r.home_college_id=(loop_item->>'home_college_id')::uuid
     AND h.home_college_id=r.home_college_id AND r.delivery_group_id=(loop_item->>'delivery_group_id')::uuid
     AND r.term_id=(loop_item->>'term_id')::uuid AND r.assigned_hours=(loop_item->>'assigned_hours')::numeric
     AND r.decided_by IS NOT NULL AND r.decided_at IS NOT NULL) THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_FOREIGN_APPROVAL_DRIFT' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION itcs_cutover_private.assert_operational_adoption_target(p_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.operational_adoption_profiles%ROWTYPE; v uuid; s public.schedule_sessions%ROWTYPE;
 guard jsonb; conflicts jsonb; coverage jsonb; n integer; hours numeric; loop_item jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT p FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=p_profile;
 v:=(p.payload->>'version_id')::uuid;
 SELECT count(*),sum(extract(epoch FROM end_time-start_time)/3600) INTO n,hours
 FROM public.schedule_sessions WHERE schedule_version_id=v;
 IF n<>(p.payload->'counts'->>'sessions')::integer OR hours<>(p.payload->'counts'->>'hours')::numeric
  OR itcs_cutover_private.operational_adoption_immutable_snapshot(v) IS DISTINCT FROM p.immutable_session_snapshot
  OR itcs_cutover_private.delivery_facts_snapshot(v) IS DISTINCT FROM p.payload->>'facts_snapshot'
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.payload->'sessions') x
   LEFT JOIN public.schedule_sessions actual ON actual.id=(x->>'session_id')::uuid AND actual.schedule_version_id=v
   WHERE actual.id IS NULL OR (actual.teaching_assignment_id,actual.instructor_id,actual.day_of_week,
    actual.start_time,actual.end_time,actual.room_id) IS DISTINCT FROM
    ((x->'new'->>'assignment_id')::uuid,(x->'new'->>'instructor_id')::uuid,(x->'new'->>'day_of_week')::smallint,
     (x->'new'->>'start_time')::time,(x->'new'->>'end_time')::time,(x->'new'->>'room_id')::uuid)) THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_TARGET_DRIFT' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM assignment_version_private.operational_scope_withdrawals WHERE profile=p_profile)
   <>(p.payload->'counts'->>'withdrawals')::integer
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.payload->'withdrawals') x
    LEFT JOIN assignment_version_private.operational_scope_withdrawals w ON w.assignment_id=(x->>'assignment_id')::uuid
    LEFT JOIN assignment_version_private.scope original ON original.assignment_id=w.assignment_id
    WHERE w.assignment_id IS NULL OR w.version_id<>v OR w.profile<>p_profile OR w.manifest_sha<>p.manifest_sha
     OR w.replaces_assignment_id<>(x->>'replaces_assignment_id')::uuid
     OR w.adopted_assignment_id<>(x->>'adopted_assignment_id')::uuid
     OR w.scope_before IS DISTINCT FROM to_jsonb(original)) THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_WITHDRAWAL_DRIFT' USING ERRCODE='23514'; END IF;
 PERFORM itcs_cutover_private.assert_operational_adoption_reference(p_profile);
 -- Reject whole-version eligibility/load failures before collecting every
 -- session conflict; successful targets still run every canonical check.
 PERFORM assignment_version_private.assert_version_instructors(v);
 PERFORM assignment_version_private.assert_projected_load(v);
 FOR s IN SELECT * FROM public.schedule_sessions WHERE schedule_version_id=v ORDER BY id LOOP
  guard:=public._sb_v2_assignment_guard(s.teaching_assignment_id,v);
  IF (guard->>'ok')::boolean IS DISTINCT FROM true
   OR NOT EXISTS (SELECT 1 FROM public.version_effective_assignments(v) e WHERE e.assignment_id=s.teaching_assignment_id) THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_VALIDATION_FAILED' USING ERRCODE='23514',DETAIL=guard::text; END IF;
  PERFORM public.validate_version_assignment_allocation(v,s.delivery_group_id,
   (SELECT weekly_contact_hours FROM public.plan_course_components WHERE id=s.plan_course_component_id));
  conflicts:=public._collect_schedule_session_move_conflicts(s.id,s.college_id,v,s.instructor_id,
   s.section_id,s.course_offering_id,s.teaching_assignment_id,s.study_system,s.expected_students,
   s.day_of_week,s.start_time,s.end_time,s.room_id);
  IF jsonb_array_length(coalesce(conflicts->'blocking_conflicts','[]'::jsonb))<>0
   OR jsonb_array_length(coalesce(conflicts->'warnings','[]'::jsonb))<>0
   OR jsonb_array_length(coalesce(conflicts->'approved_exceptions','[]'::jsonb))<>0 THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_VALIDATION_FAILED' USING ERRCODE='23514',
    DETAIL=jsonb_build_object('session_id',s.id,'conflicts',conflicts)::text; END IF;
 END LOOP;
 coverage:=public.schedule_version_delivery_coverage((p.payload->>'college_id')::uuid,v);
 IF (coverage->>'complete')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_VALIDATION_FAILED' USING ERRCODE='23514',DETAIL=coverage::text; END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
END $$;

CREATE FUNCTION public.itcs_operational_adoption_preview(p_profile text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.operational_adoption_profiles%ROWTYPE; v public.schedule_versions%ROWTYPE;
 applied jsonb; published jsonb; q public.schedule_quality_runs%ROWTYPE; snap text; baseline boolean; sealed boolean;
 metadata_valid boolean:=true;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=p_profile;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PROFILE_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM public.schedule_versions WHERE id=(p.payload->>'version_id')::uuid;
 SELECT result INTO applied FROM itcs_cutover_private.runs WHERE version_id=v.id AND manifest_sha=p.manifest_sha AND stage='applied';
 SELECT result INTO published FROM itcs_cutover_private.runs WHERE version_id=v.id AND manifest_sha=p.manifest_sha AND stage='published';
 SELECT * INTO q FROM public.schedule_quality_runs WHERE schedule_version_id=v.id AND college_id=v.college_id ORDER BY created_at DESC,id DESC LIMIT 1;
 snap:=public.schedule_version_session_snapshot(v.id);
 BEGIN
  PERFORM itcs_cutover_private.assert_operational_adoption_reference(p.profile);
  PERFORM itcs_cutover_private.assert_operational_adoption_history(p.profile);
 EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE '40001' THEN
  metadata_valid:=false;
 END;
 baseline:=v.status=p.payload->>'expected_version_status'
  AND v.updated_at=(p.payload->>'expected_version_updated_at')::timestamptz
  AND v.eligibility_revision=(p.payload->>'expected_eligibility_revision')::bigint
  AND snap=p.payload->>'before_snapshot' AND metadata_valid
  AND (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) FROM public.schedule_sessions s WHERE schedule_version_id=v.id)=p.payload->>'before_full_snapshot'
  AND itcs_cutover_private.delivery_facts_snapshot(v.id)=p.payload->>'facts_snapshot';
 sealed:=applied IS NOT NULL AND applied->>'after_snapshot'=snap
  AND (applied->>'revision')::bigint=v.eligibility_revision
  AND (applied->>'version_updated_at')::timestamptz=v.updated_at AND metadata_valid
  AND itcs_cutover_private.operational_adoption_immutable_snapshot(v.id)=p.immutable_session_snapshot
  AND itcs_cutover_private.delivery_facts_snapshot(v.id)=p.payload->>'facts_snapshot'
  AND (SELECT count(*) FROM assignment_version_private.operational_scope_withdrawals WHERE profile=p.profile)=(p.payload->'counts'->>'withdrawals')::integer
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.payload->'withdrawals') x
   LEFT JOIN assignment_version_private.operational_scope_withdrawals w ON w.assignment_id=(x->>'assignment_id')::uuid
   LEFT JOIN assignment_version_private.scope original ON original.assignment_id=w.assignment_id
   WHERE w.assignment_id IS NULL OR w.profile<>p.profile OR w.version_id<>v.id OR w.manifest_sha<>p.manifest_sha
    OR w.adopted_assignment_id<>(x->>'adopted_assignment_id')::uuid OR w.scope_before IS DISTINCT FROM to_jsonb(original))
  AND EXISTS (SELECT 1 FROM assignment_version_private.publish_expectation e
   WHERE e.version_id=v.id AND e.expected_sessions=(p.payload->'counts'->>'sessions')::integer AND e.expected_snapshot=snap);
 RETURN jsonb_build_object('ok',true,'profile',p.profile,'manifest_sha',p.manifest_sha,
  'college_id',v.college_id,'term_id',v.academic_term_id,'version_id',v.id,
  'published_version_id',p.payload->>'published_version_id','published_snapshot',p.payload->>'published_snapshot',
  'version_status',v.status,'version_updated_at',v.updated_at,'eligibility_revision',v.eligibility_revision,
  'expected_version_status',p.payload->>'expected_version_status',
  'expected_version_updated_at',p.payload->>'expected_version_updated_at',
  'expected_eligibility_revision',(p.payload->>'expected_eligibility_revision')::bigint,
  'counts',p.payload->'counts','waiting',p.payload->'waiting','limitations',p.payload->'limitations',
  'current_snapshot',snap,'baseline_matches',coalesce(baseline,false),'sealed',coalesce(sealed,false),
  'applied_receipt',applied,'published_receipt',published,
  'fresh_quality',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'revision',q.eligibility_revision,
   'eligibility_revision',q.eligibility_revision,'hard_conflicts_count',q.hard_conflicts_count,'created_at',q.created_at) END,
  'publish_ready',coalesce(v.status='draft' AND sealed AND q.id IS NOT NULL
    AND q.eligibility_revision=v.eligibility_revision AND q.hard_conflicts_count=0
    AND q.created_at>=(applied->>'created_at')::timestamptz,false));
END $$;

CREATE FUNCTION itcs_cutover_private.operational_adoption_execute(p_stage text,p_version uuid,p_published uuid,
 p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.operational_adoption_profiles%ROWTYPE; v public.schedule_versions%ROWTYPE;
 loop_item jsonb; prior jsonb; result jsonb; q public.schedule_quality_runs%ROWTYPE; n integer; snap text; gate jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_stage NOT IN ('operational_check','operational_apply','operational_publish') THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_STAGE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=p_manifest->>'profile' FOR UPDATE;
 IF NOT FOUND OR p_manifest IS DISTINCT FROM jsonb_build_object('profile',p.profile)
  OR p.manifest_sha IS DISTINCT FROM p_manifest_sha OR md5(p.payload::text) IS DISTINCT FROM p.manifest_sha
  OR p_version IS DISTINCT FROM (p.payload->>'version_id')::uuid
  OR p_published IS DISTINCT FROM (p.payload->>'published_version_id')::uuid
  OR p_expected_published_snapshot IS DISTINCT FROM p.payload->>'published_snapshot' THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PROFILE_MISMATCH' USING ERRCODE='23514'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_version::text,9174));
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version FOR UPDATE;
 IF v.college_id IS DISTINCT FROM (p.payload->>'college_id')::uuid
  OR v.academic_term_id IS DISTINCT FROM (p.payload->>'term_id')::uuid OR v.is_coordination OR v.disposable_test THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PROFILE_MISMATCH' USING ERRCODE='23514'; END IF;
 PERFORM itcs_cutover_private.assert_operational_adoption_history(p.profile);
 SELECT r.result INTO result FROM itcs_cutover_private.runs r
  WHERE r.version_id=p_version AND r.manifest_sha=p.manifest_sha AND r.stage='published';
 IF result IS NOT NULL THEN
  IF p_stage<>'operational_publish' OR v.status<>'published'
   OR public.schedule_version_session_snapshot(p_version) IS DISTINCT FROM result->>'after_snapshot'
   OR v.eligibility_revision IS DISTINCT FROM (result->>'revision')::bigint
   OR v.updated_at IS DISTINCT FROM (result->>'version_updated_at')::timestamptz
   OR (SELECT status FROM public.schedule_versions WHERE id=p_published) IS DISTINCT FROM 'archived'
   OR (SELECT count(*) FROM public.schedule_versions WHERE college_id=v.college_id
      AND academic_term_id=v.academic_term_id AND status='published')<>1 THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_SEAL_DRIFT' USING ERRCODE='23514'; END IF;
  PERFORM itcs_cutover_private.assert_operational_adoption_target(p.profile);
  RETURN result||jsonb_build_object('replayed',true);
 END IF;
 IF (SELECT status FROM public.schedule_versions WHERE id=p_published) IS DISTINCT FROM 'published'
  OR public.schedule_version_session_snapshot(p_published) IS DISTINCT FROM p_expected_published_snapshot THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_HISTORY_DRIFT' USING ERRCODE='23514'; END IF;
 SELECT r.result INTO prior FROM itcs_cutover_private.runs r
  WHERE version_id=p_version AND manifest_sha=p.manifest_sha AND stage='applied';
 IF prior IS NOT NULL THEN
  IF v.status<>'draft' OR public.schedule_version_session_snapshot(p_version) IS DISTINCT FROM prior->>'after_snapshot'
   OR v.eligibility_revision IS DISTINCT FROM (prior->>'revision')::bigint
   OR v.updated_at IS DISTINCT FROM (prior->>'version_updated_at')::timestamptz
   OR NOT EXISTS (SELECT 1 FROM assignment_version_private.publish_expectation e
    WHERE e.version_id=p_version AND e.expected_sessions=(p.payload->'counts'->>'sessions')::integer
      AND e.expected_snapshot=prior->>'after_snapshot') THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_SEAL_DRIFT' USING ERRCODE='23514'; END IF;
  PERFORM itcs_cutover_private.assert_operational_adoption_target(p.profile);
  IF p_stage IN ('operational_check','operational_apply') THEN
   RETURN prior||jsonb_build_object('stage',CASE p_stage WHEN 'operational_check' THEN 'checked' ELSE 'applied' END,
    'rolled_back',p_stage='operational_check','replayed',true);
  END IF;
 ELSIF p_stage='operational_publish' THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_APPLY_REQUIRED' USING ERRCODE='23514';
 END IF;

 IF p_stage IN ('operational_check','operational_apply') THEN
  IF v.status IS DISTINCT FROM p.payload->>'expected_version_status'
   OR v.updated_at IS DISTINCT FROM (p.payload->>'expected_version_updated_at')::timestamptz
   OR v.eligibility_revision IS DISTINCT FROM (p.payload->>'expected_eligibility_revision')::bigint
   OR public.schedule_version_session_snapshot(p_version) IS DISTINCT FROM p.payload->>'before_snapshot'
   OR (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) FROM public.schedule_sessions s WHERE schedule_version_id=p_version)
      IS DISTINCT FROM p.payload->>'before_full_snapshot'
   OR itcs_cutover_private.delivery_facts_snapshot(p_version) IS DISTINCT FROM p.payload->>'facts_snapshot' THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_BASELINE_DRIFT' USING ERRCODE='40001'; END IF;
  -- Locks are held before comparing individual CAS tokens and allocating the
  -- whole target. This is never a series of delete/create or partial moves.
  PERFORM 1 FROM public.schedule_sessions WHERE schedule_version_id=p_version ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.teaching_assignments WHERE id IN (
   SELECT (x->>'old_assignment_id')::uuid FROM jsonb_array_elements(p.payload->'sessions') x UNION
   SELECT (x->'new'->>'assignment_id')::uuid FROM jsonb_array_elements(p.payload->'sessions') x) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM assignment_version_private.scope WHERE version_id=p_version
   OR assignment_id IN (SELECT (x->>'assignment_id')::uuid FROM jsonb_array_elements(p.payload->'promoted_reuses') x)
   ORDER BY assignment_id FOR UPDATE;
  PERFORM itcs_cutover_private.assert_operational_adoption_reference(p.profile);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p.payload->'sessions') x
    LEFT JOIN public.schedule_sessions s ON s.id=(x->>'session_id')::uuid AND s.schedule_version_id=p_version
    WHERE s.id IS NULL OR s.updated_at IS DISTINCT FROM (x->>'expected_updated_at')::timestamptz
      OR ((x->>'assignment_changed')::boolean OR (x->>'placement_changed')::boolean) AND s.is_locked)
   OR EXISTS (SELECT 1 FROM assignment_version_private.promotions WHERE version_id=p_version)
   OR EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals WHERE version_id=p_version) THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_BASELINE_DRIFT' USING ERRCODE='40001'; END IF;
  FOR loop_item IN SELECT t FROM jsonb_array_elements(p.payload->'withdrawals') t LOOP
   IF NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s JOIN public.teaching_assignments a ON a.id=s.assignment_id
      WHERE s.assignment_id=(loop_item->>'assignment_id')::uuid AND s.version_id=p_version AND a.is_active
       AND s.replaces_assignment_id=(loop_item->>'replaces_assignment_id')::uuid
       AND s.created_at=(loop_item->>'expected_scope_created_at')::timestamptz)
    OR EXISTS (SELECT 1 FROM public.schedule_sessions s WHERE s.teaching_assignment_id=(loop_item->>'assignment_id')::uuid
      AND s.schedule_version_id<>p_version) THEN
    RAISE EXCEPTION 'OPERATIONAL_ADOPTION_WITHDRAWAL_DRIFT' USING ERRCODE='23514'; END IF;
  END LOOP;
  BEGIN
   PERFORM public.transition_schedule_version(v.college_id,p_version,'review','draft',
    'اعتماد الإسناد التشغيلي الحالي؛ '||p.manifest_sha);
   INSERT INTO assignment_version_private.operational_scope_withdrawals
    (assignment_id,version_id,replaces_assignment_id,adopted_assignment_id,profile,manifest_sha,scope_before,created_by)
   SELECT s.assignment_id,s.version_id,s.replaces_assignment_id,(x->>'adopted_assignment_id')::uuid,
    p.profile,p.manifest_sha,to_jsonb(s),auth.uid()
   FROM jsonb_array_elements(p.payload->'withdrawals') x JOIN assignment_version_private.scope s
    ON s.assignment_id=(x->>'assignment_id')::uuid;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>(p.payload->'counts'->>'withdrawals')::integer THEN RAISE EXCEPTION 'OPERATIONAL_ADOPTION_WITHDRAWAL_DRIFT'; END IF;
   UPDATE public.schedule_sessions s SET
    teaching_assignment_id=(x->'new'->>'assignment_id')::uuid,instructor_id=(x->'new'->>'instructor_id')::uuid,
    day_of_week=(x->'new'->>'day_of_week')::smallint,start_time=(x->'new'->>'start_time')::time,
    end_time=(x->'new'->>'end_time')::time,room_id=(x->'new'->>'room_id')::uuid
   FROM jsonb_array_elements(p.payload->'sessions') x
   WHERE s.id=(x->>'session_id')::uuid AND s.schedule_version_id=p_version
    AND ((x->>'assignment_changed')::boolean OR (x->>'placement_changed')::boolean);
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>(p.payload->'counts'->>'joint_session_changes')::integer THEN RAISE EXCEPTION 'OPERATIONAL_ADOPTION_TARGET_DRIFT'; END IF;
   UPDATE public.schedule_versions SET eligibility_revision=eligibility_revision+1,updated_at=now() WHERE id=p_version;
   PERFORM itcs_cutover_private.assert_operational_adoption_target(p.profile);
   PERFORM itcs_cutover_private.assert_operational_adoption_history(p.profile);
   snap:=public.schedule_version_session_snapshot(p_version);
   PERFORM public.seal_version_publish_expectation(p_version,(p.payload->'counts'->>'sessions')::integer,snap);
   gate:=public.version_scoped_publish_gate(p_version);
   IF (gate->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OPERATIONAL_ADOPTION_VALIDATION_FAILED' USING ERRCODE='23514',DETAIL=gate::text; END IF;
   SELECT * INTO v FROM public.schedule_versions WHERE id=p_version;
   result:=jsonb_build_object('ok',true,'profile',p.profile,'manifest_sha',p.manifest_sha,'version_id',p_version,
    'college_id',v.college_id,'term_id',v.academic_term_id,
    'published_version_id',p_published,'stage',CASE p_stage WHEN 'operational_check' THEN 'checked' ELSE 'applied' END,
    'counts',p.payload->'counts','waiting',p.payload->'waiting','after_snapshot',snap,'sealed',true,
    'revision',v.eligibility_revision,'eligibility_revision',v.eligibility_revision,'version_updated_at',v.updated_at,
    'created_at',now(),'rolled_back',p_stage='operational_check','quality_run_required',true);
   IF p_stage='operational_check' THEN RAISE EXCEPTION USING ERRCODE='P1600',MESSAGE=result::text; END IF;
   INSERT INTO itcs_cutover_private.runs(version_id,manifest_sha,stage,result,actor)
    VALUES(p_version,p.manifest_sha,'applied',result,auth.uid());
   INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(auth.uid(),'itcs_operational_assignments_adopted','schedule_versions',p_version,v.college_id,result);
  EXCEPTION WHEN SQLSTATE 'P1600' THEN
   GET STACKED DIAGNOSTICS snap=MESSAGE_TEXT;
   RETURN snap::jsonb;
  END;
  RETURN result;
 END IF;

 SELECT * INTO q FROM public.schedule_quality_runs WHERE schedule_version_id=p_version AND college_id=v.college_id
  ORDER BY created_at DESC,id DESC LIMIT 1;
 IF q.id IS NULL OR q.eligibility_revision IS DISTINCT FROM v.eligibility_revision
  OR q.hard_conflicts_count IS DISTINCT FROM 0 OR q.created_at<(prior->>'created_at')::timestamptz THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_QUALITY_REQUIRED' USING ERRCODE='23514'; END IF;
 gate:=public.version_scoped_publish_gate(p_version);
 IF (gate->>'ok')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_VALIDATION_FAILED' USING ERRCODE='23514',DETAIL=gate::text; END IF;
 PERFORM public.transition_schedule_version(v.college_id,p_version,'draft','review','اعتماد الإسناد التشغيلي؛ '||p.manifest_sha);
 PERFORM public.transition_schedule_version(v.college_id,p_version,'review','approved','اعتماد الإسناد التشغيلي؛ '||p.manifest_sha);
 PERFORM public.transition_schedule_version(v.college_id,p_version,'approved','published','اعتماد الإسناد التشغيلي؛ '||p.manifest_sha);
 PERFORM public.transition_schedule_version(v.college_id,p_published,'published','archived','استبدلت بالنسخة '||p_version);
 PERFORM itcs_cutover_private.assert_operational_adoption_target(p.profile);
 PERFORM itcs_cutover_private.assert_operational_adoption_history(p.profile);
 IF (SELECT count(*) FROM public.schedule_versions WHERE college_id=v.college_id
     AND academic_term_id=v.academic_term_id AND status='published')<>1
  OR (SELECT status FROM public.schedule_versions WHERE id=p_version) IS DISTINCT FROM 'published' THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_PUBLISHED_STATE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version;
 result:=jsonb_build_object('ok',true,'stage','published','profile',p.profile,'manifest_sha',p.manifest_sha,
  'college_id',v.college_id,'term_id',v.academic_term_id,
  'version_id',p_version,'published_version_id',p_published,'counts',p.payload->'counts','waiting',p.payload->'waiting',
  'after_snapshot',prior->>'after_snapshot','sealed',true,'revision',v.eligibility_revision,
  'eligibility_revision',v.eligibility_revision,'version_updated_at',v.updated_at,'quality_run_id',q.id,
  'created_at',now(),'rolled_back',false);
 INSERT INTO itcs_cutover_private.runs(version_id,manifest_sha,stage,result,actor)
  VALUES(p_version,p.manifest_sha,'published',result,auth.uid());
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES(auth.uid(),'itcs_operational_assignments_published','schedule_versions',p_version,v.college_id,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION itcs_cutover_private.operational_adoption_assignment_snapshot(text),
 itcs_cutover_private.operational_adoption_scope_snapshot(text),itcs_cutover_private.operational_adoption_immutable_snapshot(uuid),
 itcs_cutover_private.assert_operational_adoption_history(text),itcs_cutover_private.assert_operational_adoption_reference(text),
 itcs_cutover_private.assert_operational_adoption_target(text),
 itcs_cutover_private.operational_adoption_execute(text,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.itcs_operational_adoption_preview(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.itcs_operational_adoption_preview(text) TO authenticated;

DO $entry$
DECLARE d text:=pg_get_functiondef('public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 needle text:=E'BEGIN\n';
BEGIN
 IF position(needle IN d)=0 OR position('operational_adoption_execute' IN d)>0 THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_ENTRYPOINT_DRIFT'; END IF;
 EXECUTE overlay(d placing needle||'  IF p_manifest->>''profile''=''itcs_current_operational_20261002'' THEN
    RETURN itcs_cutover_private.operational_adoption_execute(p_stage,p_version,p_published,p_manifest,p_manifest_sha,p_expected_published_snapshot);
  END IF;
' from position(needle IN d) for length(needle));
 UPDATE itcs_cutover_private.operational_adoption_original_defs SET installed_hash=md5(pg_get_functiondef(signature::regprocedure));
END $entry$;

NOTIFY pgrst,'reload schema';
COMMIT;
