-- Correct one source-only instructor identity in a sealed revision. Published
-- sessions stay immutable. Source exceptions follow exact, privately recorded
-- copies; they cannot authorize a new time, room, group, course or extra session.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA education_source_revision_private;
REVOKE ALL ON SCHEMA education_source_revision_private FROM PUBLIC, anon, authenticated;

CREATE TABLE education_source_revision_private.revisions (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  college_id uuid NOT NULL,
  term_id uuid NOT NULL,
  corrected_source_session_id uuid NOT NULL REFERENCES public.schedule_sessions(id),
  corrected_instructor_id uuid NOT NULL REFERENCES public.instructors(id),
  source_session_hash text NOT NULL,
  source_ledger_hash text NOT NULL,
  session_count integer NOT NULL,
  ledger_count integer NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (version_id <> source_version_id)
);
CREATE TABLE education_source_revision_private.sessions (
  session_id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES education_source_revision_private.revisions(version_id),
  source_session_id uuid NOT NULL REFERENCES public.schedule_sessions(id),
  original jsonb NOT NULL,
  expected jsonb NOT NULL,
  UNIQUE(version_id, source_session_id)
);
CREATE TABLE education_source_revision_private.source_rows (
  version_id uuid NOT NULL REFERENCES education_source_revision_private.revisions(version_id),
  source_row_id uuid NOT NULL REFERENCES public.existing_schedule_source_rows(id),
  original jsonb NOT NULL,
  expected jsonb NOT NULL,
  PRIMARY KEY(version_id, source_row_id)
);
ALTER TABLE education_source_revision_private.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE education_source_revision_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE education_source_revision_private.source_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA education_source_revision_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.education_source_revision_session_allowed(p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'education_source_revision_private' AS $$
  SELECT EXISTS (
    SELECT 1 FROM education_source_revision_private.sessions f
    JOIN education_source_revision_private.revisions r ON r.version_id = f.version_id
    JOIN public.schedule_versions v ON v.id = r.version_id
    JOIN public.schedule_versions old_v ON old_v.id = r.source_version_id
    JOIN public.schedule_sessions old_s ON old_s.id = f.source_session_id
    WHERE f.session_id = p_session.id AND f.version_id = p_session.schedule_version_id
      AND v.college_id = r.college_id AND v.academic_term_id = r.term_id
      AND old_v.college_id = r.college_id AND old_v.academic_term_id = r.term_id
      AND old_v.status IN ('published', 'archived')
      AND to_jsonb(old_s) = f.original
      AND to_jsonb(p_session) - ARRAY['created_at','updated_at'] =
          f.expected - ARRAY['created_at','updated_at']
  );
$$;
REVOKE ALL ON FUNCTION public.education_source_revision_session_allowed(public.schedule_sessions) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_source_revision_session_allowed(public.schedule_sessions) TO authenticated;

CREATE FUNCTION public.education_source_revision_verified(p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'education_source_revision_private' AS $$
  SELECT EXISTS (
    SELECT 1 FROM education_source_revision_private.revisions r
    JOIN public.schedule_versions v ON v.id = r.version_id
    WHERE r.version_id = p_version_id AND v.college_id = r.college_id
      AND v.academic_term_id = r.term_id
      AND (SELECT count(*) FROM public.schedule_sessions s WHERE s.schedule_version_id=r.version_id)=r.session_count
      AND (SELECT count(*) FROM education_source_revision_private.sessions f WHERE f.version_id=r.version_id)=r.session_count
      AND (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text)
           FROM public.schedule_sessions s WHERE s.schedule_version_id=r.source_version_id)=r.source_session_hash
      AND NOT EXISTS (
        SELECT 1 FROM education_source_revision_private.sessions f
        LEFT JOIN public.schedule_sessions s ON s.id=f.session_id
        WHERE f.version_id=r.version_id
          AND (s.id IS NULL OR NOT public.education_source_revision_session_allowed(s))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.education_source_revision_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_source_revision_verified(uuid) TO authenticated;

CREATE FUNCTION public.education_source_revision_named_session(p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'education_source_revision_private' AS $$
  SELECT public.education_source_revision_session_allowed(p_session) AND EXISTS (
    SELECT 1 FROM education_source_revision_private.source_rows f
    WHERE f.version_id=p_session.schedule_version_id
      AND f.expected->>'schedule_session_id'=p_session.id::text
      AND f.expected->>'delivery_group_id'=p_session.delivery_group_id::text
      AND f.expected->>'status'='imported'
      AND f.expected->'instructor_ids' @> jsonb_build_array(p_session.instructor_id)
  );
$$;
REVOKE ALL ON FUNCTION public.education_source_revision_named_session(public.schedule_sessions) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_source_revision_named_session(public.schedule_sessions) TO authenticated;

CREATE FUNCTION education_source_revision_private.guard_sessions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'education_source_revision_private' AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND EXISTS (
    SELECT 1 FROM education_source_revision_private.revisions WHERE version_id=OLD.schedule_version_id
  ) THEN
    IF TG_OP='DELETE' OR NEW.schedule_version_id IS DISTINCT FROM OLD.schedule_version_id THEN
      RAISE EXCEPTION 'SOURCE_IDENTITY_REVISION_SEALED' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND EXISTS (
    SELECT 1 FROM education_source_revision_private.revisions WHERE version_id=NEW.schedule_version_id
  ) AND NOT public.education_source_revision_session_allowed(NEW) THEN
    RAISE EXCEPTION 'SOURCE_IDENTITY_REVISION_SEALED' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION education_source_revision_private.guard_sessions() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_education_source_revision_sealed BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION education_source_revision_private.guard_sessions();

-- Operator-only creation. The existing UI still performs quality checking and
-- the normal authenticated review/approval/publication transitions.
CREATE FUNCTION education_source_revision_private.create_revision(
  p_source_version_id uuid, p_source_session_id uuid, p_instructor_id uuid,
  p_session_hash text, p_ledger_hash text, p_name text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = 'pg_catalog', 'public', 'education_source_revision_private' AS $$
DECLARE
  v_source public.schedule_versions%ROWTYPE;
  v_target public.schedule_sessions%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_id uuid := gen_random_uuid();
  v_hash text;
  v_source_count integer;
  v_ledger_count integer;
  v_count integer;
  v_table text;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'SOURCE_REVISION_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF nullif(btrim(p_name),'') IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'SOURCE_REVISION_REASON_REQUIRED';
  END IF;
  -- This workflow only inherits the already-approved Education source intake.
  IF p_source_version_id <> '7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid THEN
    RAISE EXCEPTION 'SOURCE_REVISION_SCOPE_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_version_id::text,9174));
  SELECT * INTO STRICT v_source FROM public.schedule_versions WHERE id=p_source_version_id FOR UPDATE;
  IF v_source.status<>'published'
    OR v_source.college_id<>'1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    OR v_source.academic_term_id<>'93705393-609d-4605-ae94-9572cd8b2090'::uuid
    OR EXISTS(SELECT 1 FROM education_source_revision_private.revisions WHERE source_version_id=p_source_version_id)
  THEN RAISE EXCEPTION 'SOURCE_REVISION_BASELINE_DRIFT'; END IF;
  PERFORM 1 FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id FOR SHARE;
  PERFORM 1 FROM public.existing_schedule_source_rows WHERE schedule_version_id=p_source_version_id FOR UPDATE;
  SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_source_count,v_hash
    FROM public.schedule_sessions s WHERE schedule_version_id=p_source_version_id;
  IF v_source_count<>339 OR v_hash IS DISTINCT FROM p_session_hash THEN
    RAISE EXCEPTION 'SOURCE_REVISION_SESSION_DRIFT'; END IF;
  SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_ledger_count,v_hash
    FROM public.existing_schedule_source_rows s WHERE schedule_version_id=p_source_version_id;
  IF v_ledger_count<>377 OR v_hash IS DISTINCT FROM p_ledger_hash
    OR (SELECT count(*) FROM public.existing_schedule_source_rows
         WHERE schedule_version_id=p_source_version_id AND schedule_session_id IS NOT NULL)<>309
  THEN RAISE EXCEPTION 'SOURCE_REVISION_LEDGER_DRIFT'; END IF;
  SELECT * INTO STRICT v_target FROM public.schedule_sessions
    WHERE id=p_source_session_id AND schedule_version_id=p_source_version_id;
  SELECT * INTO STRICT v_instructor FROM public.instructors WHERE id=p_instructor_id FOR SHARE;
  IF v_target.teaching_assignment_id IS NOT NULL OR p_instructor_id=v_target.instructor_id
    OR NOT v_instructor.is_active OR v_instructor.college_id<>v_source.college_id
    OR v_instructor.affiliation_college_id IS DISTINCT FROM v_source.college_id
    OR v_instructor.external_source LIKE 'EDU26F-NAME:%'
    OR NOT EXISTS(SELECT 1 FROM public.existing_schedule_source_rows r
      WHERE r.schedule_version_id=p_source_version_id AND r.schedule_session_id=p_source_session_id
       AND r.delivery_group_id=v_target.delivery_group_id AND r.status='imported'
       AND v_target.instructor_id=ANY(r.instructor_ids))
  THEN RAISE EXCEPTION 'SOURCE_REVISION_IDENTITY_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id
    AND (replaced_by_split OR split_source_session_id IS NOT NULL))
    OR EXISTS(SELECT 1 FROM public.schedule_version_conflict_exceptions
      WHERE schedule_version_id=p_source_version_id AND status='approved') THEN
    RAISE EXCEPTION 'SOURCE_REVISION_UNSUPPORTED_DEPENDENCIES';
  END IF;
  INSERT INTO public.schedule_versions
  SELECT (jsonb_populate_record(NULL::public.schedule_versions,to_jsonb(v_source)||jsonb_build_object(
    'id',v_id,'name',btrim(p_name),'status','draft','notes',p_reason,
    'created_at',now(),'updated_at',now(),'created_by',auth.uid(),
    'is_coordination',false,'disposable_test',false,'eligibility_revision',0))).*;
  INSERT INTO education_source_revision_private.revisions
    (version_id,source_version_id,college_id,term_id,corrected_source_session_id,
     corrected_instructor_id,source_session_hash,source_ledger_hash,session_count,ledger_count,reason,created_by)
  VALUES(v_id,p_source_version_id,v_source.college_id,v_source.academic_term_id,p_source_session_id,
    p_instructor_id,p_session_hash,p_ledger_hash,v_source_count,v_ledger_count,p_reason,auth.uid());

  INSERT INTO schedule_version_delivery_private.clone_provenance(version_id,source_version_id)
    VALUES(v_id,p_source_version_id);
  FOREACH v_table IN ARRAY ARRAY['scope','cohort_facts','group_facts','partner_group_facts',
    'partition_facts','group_partition_facts','shared_link_facts','partner_partition_facts',
    'component_room_type_facts','instructor_hour_waivers'] LOOP
    EXECUTE format('INSERT INTO schedule_version_delivery_private.%1$I
      SELECT (jsonb_populate_record(NULL::schedule_version_delivery_private.%1$I,
        to_jsonb(f)||jsonb_build_object(''version_id'',$1))).*
      FROM schedule_version_delivery_private.%1$I f WHERE version_id=$2',v_table)
    USING v_id,p_source_version_id;
  END LOOP;
  INSERT INTO education_source_revision_private.sessions(session_id,version_id,source_session_id,original,expected)
  SELECT new_id,v_id,s.id,to_jsonb(s),to_jsonb(s)||jsonb_build_object(
    'id',new_id,'schedule_version_id',v_id,'created_at',now(),'updated_at',now(),
    'instructor_id',CASE WHEN s.id=p_source_session_id THEN p_instructor_id ELSE s.instructor_id END)
  FROM public.schedule_sessions s CROSS JOIN LATERAL (SELECT gen_random_uuid() new_id WHERE s.id IS NOT NULL) n
  WHERE s.schedule_version_id=p_source_version_id;
  INSERT INTO education_source_revision_private.source_rows(version_id,source_row_id,original,expected)
  SELECT v_id,s.id,to_jsonb(s),to_jsonb(s)||jsonb_build_object(
    'schedule_version_id',v_id,'schedule_session_id',f.session_id,
    'instructor_ids',CASE WHEN s.schedule_session_id=p_source_session_id
      THEN ARRAY[p_instructor_id] ELSE s.instructor_ids END,
    'notes',CASE WHEN s.schedule_session_id=p_source_session_id THEN
      concat_ws(E'\n',s.notes,'تصحيح هوية المحاضر بتأكيد المستخدم: '||v_instructor.full_name||
        ' من كلية التربية والعلوم؛ شخص مستقل عن المحاضر المرتبط سابقاً. الموعد والساعات كما هما.')
      ELSE s.notes END)
  FROM public.existing_schedule_source_rows s
  LEFT JOIN education_source_revision_private.sessions f
    ON f.version_id=v_id AND f.source_session_id=s.schedule_session_id
  WHERE s.schedule_version_id=p_source_version_id;
  INSERT INTO public.schedule_sessions
    SELECT (jsonb_populate_record(NULL::public.schedule_sessions,f.expected)).*
    FROM education_source_revision_private.sessions f WHERE f.version_id=v_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_source_count OR NOT public.education_source_revision_verified(v_id) THEN
    RAISE EXCEPTION 'SOURCE_REVISION_COPY_MISMATCH';
  END IF;
  INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
  VALUES(v_source.college_id,v_id,'cloned',NULL,'draft',auth.uid(),p_reason,
    jsonb_build_object('source_version_id',p_source_version_id,'identity_corrections',1,
      'source_session_id',p_source_session_id,'previous_instructor_id',v_target.instructor_id,
      'instructor_id',p_instructor_id,'sessions_copied',v_count,'sessions_skipped',0));
  RETURN jsonb_build_object('version_id',v_id,'instructor_id',p_instructor_id,'sessions_copied',v_count);
END;
$$;
REVOKE ALL ON FUNCTION education_source_revision_private.create_revision(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION education_source_revision_private.guard_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','education_source_revision_private' AS $$
DECLARE r education_source_revision_private.revisions%ROWTYPE; v_hash text; v_count integer;
BEGIN
  SELECT * INTO r FROM education_source_revision_private.revisions WHERE version_id=NEW.id FOR UPDATE;
  IF NOT FOUND OR NEW.status NOT IN ('review','approved','published') OR NEW.status=OLD.status THEN RETURN NEW; END IF;
  IF NOT public.education_source_revision_verified(NEW.id) THEN
    RAISE EXCEPTION 'SOURCE_REVISION_NOT_VERIFIED' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>'published' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'SOURCE_REVISION_SUPER_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.source_version_id::text,9174));
  PERFORM 1 FROM public.schedule_versions WHERE id=r.source_version_id AND status='published' FOR UPDATE;
  IF NOT FOUND OR r.published_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_REVISION_STALE_PUBLICATION'; END IF;
  PERFORM 1 FROM public.existing_schedule_source_rows WHERE schedule_version_id=r.source_version_id FOR UPDATE;
  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_hash
    FROM public.existing_schedule_source_rows s WHERE schedule_version_id=r.source_version_id;
  IF v_hash IS DISTINCT FROM r.source_ledger_hash THEN RAISE EXCEPTION 'SOURCE_REVISION_LEDGER_DRIFT'; END IF;
  PERFORM public.transition_schedule_version(r.college_id,r.source_version_id,'published','archived',
    'نسخة تاريخية محفوظة؛ نشرت نسخة تصحيح هوية محاضر مع إبقاء المواعيد والساعات.');
  UPDATE public.existing_schedule_source_rows s SET
    schedule_version_id=r.version_id,
    schedule_session_id=(f.expected->>'schedule_session_id')::uuid,
    instructor_ids=ARRAY(SELECT jsonb_array_elements_text(f.expected->'instructor_ids'))::uuid[],
    notes=f.expected->>'notes'
  FROM education_source_revision_private.source_rows f
  WHERE f.version_id=r.version_id AND s.id=f.source_row_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>r.ledger_count THEN RAISE EXCEPTION 'SOURCE_REVISION_LEDGER_COUNT_DRIFT'; END IF;
  UPDATE education_source_revision_private.revisions SET published_at=now() WHERE version_id=r.version_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION education_source_revision_private.guard_publication() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_education_source_revision_publication BEFORE UPDATE OF status
ON public.schedule_versions FOR EACH ROW EXECUTE FUNCTION education_source_revision_private.guard_publication();

COMMIT;
