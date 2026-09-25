-- Stage ITCS-ISO-02b. Proposed for review; Stage 01/02a already ran on the
-- retained live versions. Do not edit draft counts until all guards are wired.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Groups outside the edited cohorts may share a lecture with an edited group.
-- Freeze their anonymous partition memberships as well as their headcounts.
CREATE TABLE schedule_version_delivery_private.partner_partition_facts (
  version_id uuid NOT NULL,
  group_id uuid NOT NULL,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id),
  partition_id uuid NOT NULL REFERENCES public.cohort_student_partitions(id),
  headcount integer NOT NULL CHECK (headcount > 0),
  PRIMARY KEY (version_id, group_id, partition_id),
  FOREIGN KEY (version_id, group_id)
    REFERENCES schedule_version_delivery_private.partner_group_facts(version_id, group_id)
);
CREATE TRIGGER partner_partition_update_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.partner_partition_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();

DO $seed$
DECLARE
  v_published constant uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  v_draft constant uuid := 'd68d8d22-9a6d-4f21-935f-cebf18bb969b';
  v_college constant uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
BEGIN
  LOCK TABLE public.delivery_group_partition_members, public.cohort_student_partitions,
    public.delivery_groups, public.schedule_sessions IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT count(*) FROM schedule_version_delivery_private.scope
      WHERE version_id IN (v_published,v_draft)) <> 10
     OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v_published) <> 275
     OR EXISTS (
       SELECT 1 FROM public.schedule_version_delivery_baselines b
       WHERE b.schedule_version_id=v_published AND b.published_version_digest IS DISTINCT FROM (
         SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))
         FROM public.schedule_sessions s WHERE s.schedule_version_id=v_published
       )
     ) THEN
    RAISE EXCEPTION 'ITCS_VERSION_MEMBERSHIP_BASELINE_CHANGED' USING ERRCODE='23514';
  END IF;
  -- Seed both retained versions before enabling the published insert guard.
  INSERT INTO schedule_version_delivery_private.partner_partition_facts
    (version_id,group_id,cohort_id,partition_id,headcount)
  SELECT pf.version_id,m.delivery_group_id,m.cohort_id,m.partition_id,p.headcount
  FROM schedule_version_delivery_private.partner_group_facts pf
  JOIN public.delivery_groups g ON g.id=pf.group_id AND g.college_id=v_college
  JOIN public.delivery_group_partition_members m ON m.delivery_group_id=g.id
  JOIN public.cohort_student_partitions p
    ON p.id=m.partition_id AND p.cohort_id=g.cohort_id AND p.active AND p.headcount>0
  WHERE pf.version_id IN (v_published,v_draft)
    AND NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.scope s
      WHERE s.version_id=pf.version_id AND s.cohort_id=g.cohort_id
    );
  CREATE TRIGGER partner_partition_insert_lock BEFORE INSERT
    ON schedule_version_delivery_private.partner_partition_facts
    FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_insert();
  IF EXISTS (
    SELECT 1 FROM schedule_version_delivery_private.partner_group_facts pf
    JOIN public.delivery_groups g ON g.id=pf.group_id
    LEFT JOIN schedule_version_delivery_private.scope s
      ON s.version_id=pf.version_id AND s.cohort_id=g.cohort_id
    LEFT JOIN schedule_version_delivery_private.partner_partition_facts pp
      ON pp.version_id=pf.version_id AND pp.group_id=pf.group_id
    WHERE pf.version_id IN (v_published,v_draft) AND s.cohort_id IS NULL
    GROUP BY pf.version_id,pf.group_id,pf.expected_students
    HAVING COALESCE(sum(pp.headcount),0) <> pf.expected_students
  ) THEN
    RAISE EXCEPTION 'ITCS_PARTNER_PARTITION_COVERAGE_MISMATCH' USING ERRCODE='23514';
  END IF;
END;
$seed$;

-- A single authoritative selected-version membership read. Each requested
-- group has at least a cohort identity row, even without any partitions.
-- An absent scoped group fact is an error (e.g. a new draft group in V2).
CREATE FUNCTION public.schedule_version_student_memberships(
  p_version uuid, p_groups uuid[]
)
RETURNS TABLE (
  delivery_group_id uuid,
  cohort_id uuid,
  partition_id uuid,
  partition_headcount integer,
  shared_lecture boolean,
  expected_students integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','schedule_version_delivery_private' AS $body$
DECLARE v_college uuid;
BEGIN
  IF p_groups IS NULL OR cardinality(p_groups)>100 THEN
    RAISE EXCEPTION 'VERSION_FACT_INVALID_BATCH' USING ERRCODE='23514';
  END IF;
  SELECT v.college_id INTO v_college FROM public.schedule_versions v WHERE v.id=p_version;
  IF v_college IS NULL OR auth.uid() IS NULL
     OR NOT public.can_view_college(auth.uid(),v_college)
     OR EXISTS (
       SELECT 1 FROM unnest(p_groups) ids(id)
       LEFT JOIN public.delivery_groups g ON g.id=ids.id
       WHERE ids.id IS NULL OR g.id IS NULL OR g.college_id IS DISTINCT FROM v_college
     ) THEN
    RAISE EXCEPTION 'VERSION_MEMBERSHIP_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_groups g
    JOIN schedule_version_delivery_private.scope s
      ON s.version_id=p_version AND s.cohort_id=g.cohort_id
    LEFT JOIN schedule_version_delivery_private.group_facts f
      ON f.version_id=p_version AND f.group_id=g.id
    WHERE g.id=ANY(p_groups) AND f.group_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VERSION_GROUP_FACT_MISSING' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM schedule_version_delivery_private.shared_link_facts l
    JOIN public.delivery_groups g ON g.id=l.member_group_id
    JOIN schedule_version_delivery_private.scope s
      ON s.version_id=p_version AND s.cohort_id=g.cohort_id
    LEFT JOIN schedule_version_delivery_private.group_facts f
      ON f.version_id=p_version AND f.group_id=g.id
    WHERE l.version_id=p_version AND l.anchor_group_id=ANY(p_groups)
      AND f.group_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VERSION_SHARED_MEMBER_FACT_MISSING' USING ERRCODE='23514';
  END IF;
  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT g.id,g.cohort_id AS own_cohort
    FROM unnest(p_groups) ids(id) JOIN public.delivery_groups g ON g.id=ids.id
  ), links AS MATERIALIZED (
    SELECT l.anchor_group_id,l.member_group_id
    FROM schedule_version_delivery_private.shared_link_facts l
    JOIN requested r ON r.id=l.anchor_group_id WHERE l.version_id=p_version
    UNION ALL
    SELECT l.anchor_group_id,l.member_group_id
    FROM public.shared_lecture_links l JOIN requested r ON r.id=l.anchor_group_id
    WHERE NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.scope s
      WHERE s.version_id=p_version AND s.cohort_id=r.own_cohort
    ) AND NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.partner_group_facts pf
      WHERE pf.version_id=p_version AND pf.group_id=r.id
    )
  ), relevant AS MATERIALIZED (
    SELECT r.id FROM requested r UNION SELECT l.member_group_id FROM links l
  ), direct AS MATERIALIZED (
    SELECT f.group_id,p.cohort_id,p.partition_id,p.headcount
    FROM schedule_version_delivery_private.group_facts f
    JOIN relevant r ON r.id=f.group_id
    JOIN schedule_version_delivery_private.group_partition_facts m
      ON m.version_id=f.version_id AND m.group_id=f.group_id
    JOIN schedule_version_delivery_private.partition_facts p
      ON p.version_id=m.version_id AND p.partition_id=m.partition_id
    WHERE f.version_id=p_version
    UNION ALL
    SELECT pp.group_id,pp.cohort_id,pp.partition_id,pp.headcount
    FROM schedule_version_delivery_private.partner_partition_facts pp
    JOIN relevant r ON r.id=pp.group_id
    LEFT JOIN schedule_version_delivery_private.scope s
      ON s.version_id=pp.version_id AND s.cohort_id=pp.cohort_id
    WHERE pp.version_id=p_version AND s.cohort_id IS NULL
    UNION ALL
    SELECT m.delivery_group_id,m.cohort_id,m.partition_id,p.headcount
    FROM public.delivery_group_partition_members m
    JOIN relevant r ON r.id=m.delivery_group_id
    JOIN public.cohort_student_partitions p
      ON p.id=m.partition_id AND p.active
    LEFT JOIN schedule_version_delivery_private.scope s
      ON s.version_id=p_version AND s.cohort_id=m.cohort_id
    LEFT JOIN schedule_version_delivery_private.partner_group_facts pf
      ON pf.version_id=p_version AND pf.group_id=m.delivery_group_id
    WHERE s.cohort_id IS NULL AND pf.group_id IS NULL
  ), members AS (
    SELECT r.id,d.cohort_id,d.partition_id,d.headcount,
      EXISTS(SELECT 1 FROM links l WHERE l.anchor_group_id=r.id) AS shared_lecture
    FROM requested r JOIN direct d ON d.group_id=r.id
    UNION ALL
    SELECT l.anchor_group_id,d.cohort_id,d.partition_id,d.headcount,true
    FROM links l JOIN direct d ON d.group_id=l.member_group_id
  ), sized AS MATERIALIZED (
    SELECT f.group_id,f.expected_students
    FROM public.schedule_version_group_facts(p_version,p_groups) f
  )
  SELECT r.id,COALESCE(m.cohort_id,r.own_cohort),m.partition_id,m.headcount,
    COALESCE(m.shared_lecture,false),
    COALESCE(z.expected_students,(public.operational_delivery_group(r.id)).expected_students)
  FROM requested r
  LEFT JOIN members m ON m.id=r.id
  LEFT JOIN sized z ON z.group_id=r.id;
END;
$body$;
REVOKE ALL ON FUNCTION public.schedule_version_student_memberships(uuid,uuid[])
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_version_student_memberships(uuid,uuid[])
  TO authenticated,service_role;

COMMIT;
