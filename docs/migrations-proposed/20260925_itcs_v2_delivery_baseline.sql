-- Stage ITCS-ISO-01. PROPOSED ONLY: review and run in a PostgreSQL migration
-- transaction before any level-one headcount or group edit. No draft edits here.
-- Source version and counts are fixed so a changed production baseline aborts.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.schedule_version_delivery_baselines (
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  published_session_count integer NOT NULL CHECK (published_session_count >= 0),
  published_session_digest text NOT NULL,
  published_version_digest text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_digest text NOT NULL,
  PRIMARY KEY (schedule_version_id, cohort_id),
  CHECK (payload_digest = md5(payload::text))
);

ALTER TABLE public.schedule_version_delivery_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_version_delivery_baselines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schedule_version_delivery_baselines TO authenticated;
GRANT SELECT ON public.schedule_version_delivery_baselines TO service_role;
CREATE POLICY svdb_read ON public.schedule_version_delivery_baselines
  FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));

CREATE FUNCTION public.guard_schedule_version_delivery_baseline()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $body$
DECLARE v_college uuid; v_status text; v_cohort_college uuid; v_term uuid; v_cohort_term uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('postgres','service_role')
       AND current_setting('gomufadhala.operational_cleanup', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PUBLISHED_DELIVERY_BASELINE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PUBLISHED_DELIVERY_BASELINE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISHED_DELIVERY_BASELINE_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT college_id, status, academic_term_id INTO v_college, v_status, v_term
    FROM public.schedule_versions WHERE id = NEW.schedule_version_id FOR SHARE;
  SELECT college_id, term_id INTO v_cohort_college, v_cohort_term
    FROM public.academic_cohorts WHERE id = NEW.cohort_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'published'
     OR v_college IS DISTINCT FROM NEW.college_id
     OR v_cohort_college IS DISTINCT FROM NEW.college_id
     OR v_cohort_term IS DISTINCT FROM v_term
     OR NEW.payload->'cohort'->>'id' IS DISTINCT FROM NEW.cohort_id::text THEN
    RAISE EXCEPTION 'PUBLISHED_DELIVERY_BASELINE_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER svdb_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.schedule_version_delivery_baselines
  FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_version_delivery_baseline();

DO $capture$
DECLARE
  v_version constant uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  v_college constant uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_term constant uuid := '18dd364a-76d7-40b8-a217-fa929c082a7f';
  r record;
  v_payload jsonb;
  v_count integer;
  v_digest text;
  v_version_digest text;
BEGIN
  -- The lock prevents an enrollment/group writer racing the snapshot.
  LOCK TABLE public.academic_cohorts, public.scheduling_cohort_term_headcounts,
    public.cohort_student_partitions, public.delivery_groups,
    public.delivery_group_partition_members, public.shared_lecture_links,
    public.teaching_assignments, public.course_offerings,
    public.schedule_sessions IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.schedule_versions
    WHERE id = v_version AND college_id = v_college AND academic_term_id = v_term
      AND status = 'published' FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id = v_version) <> 275 THEN
    RAISE EXCEPTION 'ITCS_V2_PUBLISHED_BASELINE_CHANGED' USING ERRCODE = '23514';
  END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))
    INTO v_version_digest
  FROM public.schedule_sessions s WHERE s.schedule_version_id=v_version;

  FOR r IN
    SELECT c.*, expected.old_count
    FROM (VALUES
      ('ebfc0dee-f291-4f6d-a974-d3ed1df96f3e'::uuid, 110),
      ('f8188b18-207a-4543-a3f7-89b4e8fad293'::uuid, 75),
      ('961e5b4e-12a6-4abd-a899-a317e73b102c'::uuid, 120),
      ('e1b6b48f-fe69-4020-b5b1-188397298174'::uuid, 75),
      ('862518d3-7d85-414e-92d2-a4c3feefc2b8'::uuid, 40)
    ) AS expected(cohort_id, old_count)
    JOIN public.academic_cohorts c ON c.id = expected.cohort_id
    WHERE c.college_id = v_college AND c.term_id = v_term
      AND c.expected_students = expected.old_count
    ORDER BY c.id
  LOOP
    SELECT count(*), md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))
      INTO v_count, v_digest
      FROM public.schedule_sessions s
      WHERE s.schedule_version_id = v_version AND s.cohort_id = r.id;
    IF (SELECT count(*) FROM public.scheduling_cohort_term_headcounts h
        WHERE h.cohort_id = r.id AND h.college_id = v_college AND h.term_id = v_term
          AND h.approval_status = 'approved' AND h.scheduling_headcount = r.old_count) <> 1 THEN
      RAISE EXCEPTION 'ITCS_V2_APPROVED_HEADCOUNT_CHANGED: %', r.id USING ERRCODE = '23514';
    END IF;

    SELECT jsonb_build_object(
      'cohort', to_jsonb(r) - 'old_count',
      'approved_headcounts', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
        FROM public.scheduling_cohort_term_headcounts h
        WHERE h.cohort_id = r.id AND h.term_id = v_term),
      'partitions', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb)
        FROM public.cohort_student_partitions p WHERE p.cohort_id = r.id),
      'groups', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id), '[]'::jsonb)
        FROM public.delivery_groups g WHERE g.cohort_id = r.id),
      'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
        FROM public.delivery_group_partition_members m WHERE m.cohort_id = r.id),
      'shared_links', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.anchor_group_id,l.member_group_id), '[]'::jsonb)
        FROM public.shared_lecture_links l
        WHERE l.anchor_group_id IN (
          SELECT DISTINCT touched.anchor_group_id
          FROM public.shared_lecture_links touched
          JOIN public.delivery_groups g
            ON g.id IN (touched.anchor_group_id,touched.member_group_id)
          WHERE g.cohort_id=r.id
        )),
      'shared_partner_groups', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id), '[]'::jsonb)
        FROM public.delivery_groups g
        WHERE g.cohort_id <> r.id
          AND EXISTS (
            SELECT 1 FROM public.shared_lecture_links l
            WHERE g.id IN (l.anchor_group_id,l.member_group_id)
              AND l.anchor_group_id IN (
                SELECT DISTINCT touched.anchor_group_id
                FROM public.shared_lecture_links touched
                JOIN public.delivery_groups source_group
                  ON source_group.id IN (touched.anchor_group_id,touched.member_group_id)
                WHERE source_group.cohort_id=r.id
              )
          )),
      'assignments', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
        FROM public.teaching_assignments a
        WHERE a.cohort_id = r.id),
      'published_offerings', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb)
        FROM public.course_offerings o
        WHERE o.id IN (SELECT DISTINCT s.course_offering_id FROM public.schedule_sessions s
                       WHERE s.schedule_version_id = v_version AND s.cohort_id = r.id))
    ) INTO v_payload;

    INSERT INTO public.schedule_version_delivery_baselines
      (schedule_version_id, cohort_id, college_id, published_session_count,
       published_session_digest, published_version_digest, payload, payload_digest)
    VALUES (v_version, r.id, v_college, v_count, v_digest,
            v_version_digest, v_payload, md5(v_payload::text));
  END LOOP;
  IF (SELECT count(*) FROM public.schedule_version_delivery_baselines
      WHERE schedule_version_id = v_version) <> 5 THEN
    RAISE EXCEPTION 'ITCS_V2_FIVE_COHORT_BASELINES_REQUIRED' USING ERRCODE = '23514';
  END IF;
END;
$capture$;

COMMIT;
