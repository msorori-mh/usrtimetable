-- Stage ITCS-ISO-02. PROPOSED ONLY: run after the V2 baseline migration.
-- The two retained versions get separate facts; existing global tables and
-- schedule sessions are not updated. Integration into every reader/guard is
-- required before any draft count changes.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA schedule_version_delivery_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA schedule_version_delivery_private FROM PUBLIC, anon, authenticated;

CREATE TABLE schedule_version_delivery_private.scope (
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  PRIMARY KEY (version_id, cohort_id)
);
CREATE TABLE schedule_version_delivery_private.cohort_facts (
  version_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  expected_students integer NOT NULL CHECK (expected_students > 0),
  scheduling_headcount integer NOT NULL CHECK (scheduling_headcount > 0),
  PRIMARY KEY (version_id, cohort_id),
  FOREIGN KEY (version_id, cohort_id)
    REFERENCES schedule_version_delivery_private.scope(version_id, cohort_id)
);
CREATE TABLE schedule_version_delivery_private.group_facts (
  version_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES public.delivery_groups(id),
  cohort_id uuid NOT NULL,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  group_code text NOT NULL,
  expected_students integer NOT NULL CHECK (expected_students > 0),
  capacity_limit integer CHECK (capacity_limit > 0),
  PRIMARY KEY (version_id, group_id),
  FOREIGN KEY (version_id, cohort_id)
    REFERENCES schedule_version_delivery_private.cohort_facts(version_id, cohort_id)
);
CREATE TABLE schedule_version_delivery_private.partition_facts (
  version_id uuid NOT NULL,
  partition_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  partition_code text NOT NULL,
  headcount integer NOT NULL CHECK (headcount > 0),
  PRIMARY KEY (version_id, partition_id),
  UNIQUE (version_id, cohort_id, partition_code),
  FOREIGN KEY (version_id, cohort_id)
    REFERENCES schedule_version_delivery_private.cohort_facts(version_id, cohort_id)
);
CREATE TABLE schedule_version_delivery_private.group_partition_facts (
  version_id uuid NOT NULL,
  group_id uuid NOT NULL,
  partition_id uuid NOT NULL,
  PRIMARY KEY (version_id, group_id, partition_id),
  FOREIGN KEY (version_id, group_id)
    REFERENCES schedule_version_delivery_private.group_facts(version_id, group_id),
  FOREIGN KEY (version_id, partition_id)
    REFERENCES schedule_version_delivery_private.partition_facts(version_id, partition_id)
);
CREATE TABLE schedule_version_delivery_private.shared_link_facts (
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  anchor_group_id uuid NOT NULL REFERENCES public.delivery_groups(id),
  member_group_id uuid NOT NULL REFERENCES public.delivery_groups(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  PRIMARY KEY (version_id, anchor_group_id, member_group_id)
);

CREATE FUNCTION schedule_version_delivery_private.guard_published_fact()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $guard$
DECLARE v_status text; v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  v_id := OLD.version_id;
  SELECT status INTO v_status FROM public.schedule_versions WHERE id=v_id;
  IF v_status = 'published'
     AND NOT (current_user IN ('postgres','service_role')
              AND coalesce(current_setting('gomufadhala.operational_cleanup', true),'') = 'on') THEN
    RAISE EXCEPTION 'PUBLISHED_VERSION_FACT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$guard$;
CREATE TRIGGER scope_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.scope
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE TRIGGER cohort_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.cohort_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE TRIGGER group_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.group_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE TRIGGER partition_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.partition_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE TRIGGER membership_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.group_partition_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE TRIGGER shared_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.shared_link_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();

CREATE FUNCTION schedule_version_delivery_private.guard_fact_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $scope$
DECLARE v_college uuid; v_term uuid; c_college uuid; c_term uuid; g_college uuid; g_cohort uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT college_id,academic_term_id INTO v_college,v_term
    FROM public.schedule_versions WHERE id=NEW.version_id;
  IF v_college IS NULL OR NEW.college_id IS DISTINCT FROM v_college THEN
    RAISE EXCEPTION 'VERSION_FACT_COLLEGE_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME IN ('scope','cohort_facts','group_facts','partition_facts') THEN
    SELECT college_id,term_id INTO c_college,c_term
      FROM public.academic_cohorts WHERE id=NEW.cohort_id;
    IF c_college IS DISTINCT FROM v_college OR c_term IS DISTINCT FROM v_term THEN
      RAISE EXCEPTION 'VERSION_FACT_COHORT_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='group_facts' THEN
    SELECT college_id,cohort_id INTO g_college,g_cohort
      FROM public.delivery_groups WHERE id=NEW.group_id;
    IF g_college IS DISTINCT FROM v_college OR g_cohort IS DISTINCT FROM NEW.cohort_id THEN
      RAISE EXCEPTION 'VERSION_FACT_GROUP_MISMATCH' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='shared_link_facts' THEN
    IF EXISTS (SELECT 1 FROM public.delivery_groups g
               WHERE g.id IN (NEW.anchor_group_id,NEW.member_group_id)
                 AND g.college_id IS DISTINCT FROM v_college) THEN
      RAISE EXCEPTION 'VERSION_FACT_SHARED_COLLEGE_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$scope$;
CREATE TRIGGER scope_tenant BEFORE INSERT OR UPDATE ON schedule_version_delivery_private.scope
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_fact_scope();
CREATE TRIGGER cohort_tenant BEFORE INSERT OR UPDATE ON schedule_version_delivery_private.cohort_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_fact_scope();
CREATE TRIGGER group_tenant BEFORE INSERT OR UPDATE ON schedule_version_delivery_private.group_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_fact_scope();
CREATE TRIGGER partition_tenant BEFORE INSERT OR UPDATE ON schedule_version_delivery_private.partition_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_fact_scope();
CREATE TRIGGER shared_tenant BEFORE INSERT OR UPDATE ON schedule_version_delivery_private.shared_link_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_fact_scope();

CREATE FUNCTION schedule_version_delivery_private.guard_group_partition_cohort()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $membership$
DECLARE g_cohort uuid; p_cohort uuid;
BEGIN
  SELECT cohort_id INTO g_cohort FROM schedule_version_delivery_private.group_facts
    WHERE version_id=NEW.version_id AND group_id=NEW.group_id;
  SELECT cohort_id INTO p_cohort FROM schedule_version_delivery_private.partition_facts
    WHERE version_id=NEW.version_id AND partition_id=NEW.partition_id;
  IF g_cohort IS NULL OR p_cohort IS DISTINCT FROM g_cohort THEN
    RAISE EXCEPTION 'VERSION_FACT_STUDENT_MEMBERSHIP_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$membership$;
CREATE TRIGGER membership_cohort BEFORE INSERT OR UPDATE
  ON schedule_version_delivery_private.group_partition_facts
  FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_group_partition_cohort();

DO $seed$
DECLARE
  v_published constant uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  v_draft constant uuid := 'd68d8d22-9a6d-4f21-935f-cebf18bb969b';
  v_college constant uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_term constant uuid := '18dd364a-76d7-40b8-a217-fa929c082a7f';
BEGIN
  LOCK TABLE public.schedule_versions, public.schedule_version_delivery_baselines,
    public.academic_cohorts, public.delivery_groups, public.schedule_sessions
    IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT count(*) FROM public.schedule_versions
      WHERE id IN (v_published, v_draft) AND college_id=v_college
        AND academic_term_id=v_term AND ((id=v_published AND status='published')
                                       OR (id=v_draft AND status='draft'))) <> 2
     OR (SELECT count(*) FROM public.schedule_version_delivery_baselines
         WHERE schedule_version_id=v_published) <> 5
     OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v_published) <> 275
     OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v_draft) <> 275 THEN
    RAISE EXCEPTION 'ITCS_VERSION_FACT_BASELINE_CHANGED' USING ERRCODE='23514';
  END IF;

  INSERT INTO schedule_version_delivery_private.scope(version_id,cohort_id,college_id)
  SELECT v.id,b.cohort_id,b.college_id
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  WHERE b.schedule_version_id=v_published;

  INSERT INTO schedule_version_delivery_private.cohort_facts
    (version_id, cohort_id, college_id, expected_students, scheduling_headcount)
  SELECT v.id, b.cohort_id, b.college_id,
    (b.payload->'cohort'->>'expected_students')::integer,
    (SELECT (h->>'scheduling_headcount')::integer
       FROM jsonb_array_elements(b.payload->'approved_headcounts') h
       WHERE h->>'approval_status'='approved' LIMIT 1)
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  WHERE b.schedule_version_id=v_published;

  INSERT INTO schedule_version_delivery_private.group_facts
    (version_id,group_id,cohort_id,college_id,group_code,expected_students,capacity_limit)
  SELECT v.id,(g->>'id')::uuid,b.cohort_id,b.college_id,g->>'group_code',
    (g->>'expected_students')::integer,(g->>'capacity_limit')::integer
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  CROSS JOIN LATERAL jsonb_array_elements(b.payload->'groups') g
  WHERE b.schedule_version_id=v_published;

  INSERT INTO schedule_version_delivery_private.partition_facts
    (version_id,partition_id,cohort_id,college_id,partition_code,headcount)
  SELECT v.id,(p->>'id')::uuid,b.cohort_id,b.college_id,p->>'partition_code',
    (p->>'headcount')::integer
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  CROSS JOIN LATERAL jsonb_array_elements(b.payload->'partitions') p
  WHERE b.schedule_version_id=v_published;

  INSERT INTO schedule_version_delivery_private.group_partition_facts
    (version_id,group_id,partition_id)
  SELECT v.id,(m->>'delivery_group_id')::uuid,(m->>'partition_id')::uuid
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  CROSS JOIN LATERAL jsonb_array_elements(b.payload->'memberships') m
  WHERE b.schedule_version_id=v_published;

  INSERT INTO schedule_version_delivery_private.shared_link_facts
    (version_id,anchor_group_id,member_group_id,college_id)
  SELECT DISTINCT v.id,(l->>'anchor_group_id')::uuid,(l->>'member_group_id')::uuid,b.college_id
  FROM public.schedule_version_delivery_baselines b
  CROSS JOIN (VALUES (v_published),(v_draft)) AS v(id)
  CROSS JOIN LATERAL jsonb_array_elements(b.payload->'shared_links') l
  WHERE b.schedule_version_id=v_published;

  IF (SELECT count(*) FROM schedule_version_delivery_private.scope) <> 10
     OR (SELECT count(*) FROM schedule_version_delivery_private.cohort_facts) <> 10 THEN
    RAISE EXCEPTION 'ITCS_VERSION_FACT_SCOPE_INCOMPLETE' USING ERRCODE='23514';
  END IF;
END;
$seed$;

CREATE FUNCTION public.effective_schedule_cohort_fact(p_version uuid, p_cohort uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'schedule_version_delivery_private' AS $body$
DECLARE v_college uuid; v_cohort_college uuid; v_fact record;
BEGIN
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version;
  SELECT college_id INTO v_cohort_college FROM public.academic_cohorts WHERE id=p_cohort;
  IF v_college IS NULL OR v_cohort_college IS DISTINCT FROM v_college
     OR auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(),v_college) THEN
    RAISE EXCEPTION 'VERSION_COHORT_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT expected_students,scheduling_headcount INTO v_fact
  FROM schedule_version_delivery_private.cohort_facts
  WHERE version_id=p_version AND cohort_id=p_cohort;
  IF FOUND THEN RETURN to_jsonb(v_fact); END IF;
  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope
             WHERE version_id=p_version AND cohort_id=p_cohort) THEN
    RAISE EXCEPTION 'VERSION_COHORT_FACT_MISSING' USING ERRCODE='23514';
  END IF;
  RETURN NULL; -- unscoped cohorts use the existing global read path.
END;
$body$;
REVOKE ALL ON FUNCTION public.effective_schedule_cohort_fact(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.effective_schedule_cohort_fact(uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.effective_schedule_group_fact(p_version uuid, p_group uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'schedule_version_delivery_private' AS $body$
DECLARE v_college uuid; v_group public.delivery_groups%ROWTYPE; v_fact record;
BEGIN
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version;
  SELECT * INTO v_group FROM public.delivery_groups WHERE id=p_group;
  IF v_college IS NULL OR v_group.id IS NULL OR v_group.college_id IS DISTINCT FROM v_college
     OR auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(),v_college) THEN
    RAISE EXCEPTION 'VERSION_GROUP_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT group_code,expected_students,capacity_limit INTO v_fact
  FROM schedule_version_delivery_private.group_facts
  WHERE version_id=p_version AND group_id=p_group;
  IF FOUND THEN RETURN to_jsonb(v_fact); END IF;
  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope
             WHERE version_id=p_version AND cohort_id=v_group.cohort_id) THEN
    RAISE EXCEPTION 'VERSION_GROUP_FACT_MISSING' USING ERRCODE='23514';
  END IF;
  RETURN NULL; -- unscoped groups use the existing global read path.
END;
$body$;
REVOKE ALL ON FUNCTION public.effective_schedule_group_fact(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.effective_schedule_group_fact(uuid,uuid) TO authenticated,service_role;

COMMIT;
