-- JAWF-STUDENT-PARTITIONS-02 — durable shared-student semantics for delivery groups.
-- PROPOSED ONLY. Not applied by the agent. Root applies through the existing
-- authorized Lovable-native migration workflow.
--
-- Adds explicit anonymous student partitions per cohort (no student PII) and an
-- explicit delivery-group -> partition membership map, then makes the single
-- server conflict helper `_sb_v2_delivery_group_overlap` partition-aware.
-- Everything unmapped, incomplete or inconsistent keeps the existing
-- conservative cohort-wide conflict (fail closed).

BEGIN;

-- 1. Anonymous student partitions of a cohort ---------------------------------
CREATE TABLE IF NOT EXISTS public.cohort_student_partitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id) ON DELETE CASCADE,
  partition_code text NOT NULL,
  headcount integer NOT NULL CHECK (headcount > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_student_partitions_code_uniq UNIQUE (cohort_id, partition_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_student_partitions TO authenticated;
GRANT ALL ON public.cohort_student_partitions TO service_role;

ALTER TABLE public.cohort_student_partitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY csp_select ON public.cohort_student_partitions
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY csp_insert ON public.cohort_student_partitions
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY csp_update ON public.cohort_student_partitions
  FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY csp_delete ON public.cohort_student_partitions
  FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));

-- 2. Delivery group -> partition membership -----------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_group_partition_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id) ON DELETE CASCADE,
  delivery_group_id uuid NOT NULL REFERENCES public.delivery_groups(id) ON DELETE CASCADE,
  partition_id uuid NOT NULL REFERENCES public.cohort_student_partitions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dgpm_uniq UNIQUE (delivery_group_id, partition_id)
);

CREATE INDEX IF NOT EXISTS dgpm_group_idx ON public.delivery_group_partition_members (delivery_group_id);
CREATE INDEX IF NOT EXISTS dgpm_partition_idx ON public.delivery_group_partition_members (partition_id);
CREATE INDEX IF NOT EXISTS dgpm_cohort_idx ON public.delivery_group_partition_members (cohort_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_group_partition_members TO authenticated;
GRANT ALL ON public.delivery_group_partition_members TO service_role;

ALTER TABLE public.delivery_group_partition_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY dgpm_select ON public.delivery_group_partition_members
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY dgpm_insert ON public.delivery_group_partition_members
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dgpm_update ON public.delivery_group_partition_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dgpm_delete ON public.delivery_group_partition_members
  FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));

-- 3. Tenant / cohort isolation triggers ---------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_csp_cohort_college()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_college uuid;
BEGIN
  SELECT college_id INTO v_college FROM public.academic_cohorts WHERE id = NEW.cohort_id;
  IF v_college IS NULL THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND: الدفعة غير موجودة.';
  END IF;
  IF NEW.college_id IS DISTINCT FROM v_college THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_FORBIDDEN: الشُعبة لا تنتمي لكلية الدفعة.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_csp_cohort_college ON public.cohort_student_partitions;
CREATE TRIGGER trg_csp_cohort_college
  BEFORE INSERT OR UPDATE ON public.cohort_student_partitions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_csp_cohort_college();

CREATE OR REPLACE FUNCTION public.ensure_dgpm_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
  v_p public.cohort_student_partitions%ROWTYPE;
BEGIN
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = NEW.delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND: مجموعة التقديم غير موجودة.';
  END IF;
  SELECT * INTO v_p FROM public.cohort_student_partitions WHERE id = NEW.partition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTITION_NOT_FOUND: شُعبة الطلاب غير موجودة.';
  END IF;
  IF v_dg.cohort_id IS DISTINCT FROM v_p.cohort_id
     OR NEW.cohort_id IS DISTINCT FROM v_dg.cohort_id THEN
    RAISE EXCEPTION 'COHORT_MISMATCH: مجموعة التقديم وشُعبة الطلاب من دفعتين مختلفتين.';
  END IF;
  IF v_dg.college_id IS DISTINCT FROM v_p.college_id
     OR NEW.college_id IS DISTINCT FROM v_dg.college_id THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_FORBIDDEN: الربط يتجاوز حدود الكلية.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dgpm_consistency ON public.delivery_group_partition_members;
CREATE TRIGGER trg_dgpm_consistency
  BEFORE INSERT OR UPDATE ON public.delivery_group_partition_members
  FOR EACH ROW EXECUTE FUNCTION public.ensure_dgpm_consistency();

-- 4. Shared-student authority helper -----------------------------------------
-- Returns TRUE (conflict) unless BOTH groups carry a complete, consistent
-- mapping in the same cohort and their partition sets are disjoint.
CREATE OR REPLACE FUNCTION public.delivery_groups_share_students(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a_cohort uuid; b_cohort uuid;
  a_expected integer; b_expected integer;
  a_count integer; b_count integer;
  a_cover integer; b_cover integer;
  v_shared integer;
BEGIN
  IF p_a IS NULL OR p_b IS NULL THEN RETURN true; END IF;
  IF p_a = p_b THEN RETURN true; END IF;

  SELECT cohort_id, expected_students INTO a_cohort, a_expected
  FROM public.delivery_groups WHERE id = p_a;
  SELECT cohort_id, expected_students INTO b_cohort, b_expected
  FROM public.delivery_groups WHERE id = p_b;
  IF a_cohort IS NULL OR b_cohort IS NULL THEN RETURN true; END IF;
  IF a_cohort IS DISTINCT FROM b_cohort THEN RETURN false; END IF;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO a_count, a_cover
  FROM public.delivery_group_partition_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_a AND m.cohort_id = a_cohort AND p.cohort_id = a_cohort;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO b_count, b_cover
  FROM public.delivery_group_partition_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_b AND m.cohort_id = b_cohort AND p.cohort_id = b_cohort;

  -- unmapped or incomplete coverage → conservative conflict
  IF a_count = 0 OR b_count = 0 THEN RETURN true; END IF;
  IF a_cover < COALESCE(a_expected, 0) OR b_cover < COALESCE(b_expected, 0) THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_shared
  FROM public.delivery_group_partition_members ma
  JOIN public.delivery_group_partition_members mb
    ON mb.partition_id = ma.partition_id
  WHERE ma.delivery_group_id = p_a AND mb.delivery_group_id = p_b;

  RETURN v_shared > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_groups_share_students(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_groups_share_students(uuid, uuid) TO authenticated, service_role;

-- 5. Partition-aware conflict helper (single server authority) ----------------
-- Callers unchanged: create_schedule_session_from_assignment_v2,
-- validate_schedule_session_move, move_or_reschedule_schedule_session.
CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
  p_schedule_version_id uuid,
  p_delivery_group_id uuid,
  p_cohort_id uuid,
  p_day_of_week integer,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_exclude_session_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_peer record;
  v_conflicts jsonb := '[]'::jsonb;
  v_shared boolean;
BEGIN
  IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN
    RETURN v_conflicts;
  END IF;

  FOR v_peer IN
    SELECT ss.id, ss.delivery_group_id, ss.cohort_id
    FROM public.schedule_sessions ss
    WHERE ss.schedule_version_id = p_schedule_version_id
      AND ss.day_of_week = p_day_of_week
      AND ss.start_time < p_end_time
      AND p_start_time < ss.end_time
      AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id)
      AND (
        (p_delivery_group_id IS NOT NULL AND ss.delivery_group_id = p_delivery_group_id)
        OR (p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id)
      )
  LOOP
    v_shared := true;
    IF p_delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id <> p_delivery_group_id THEN
      v_shared := public.delivery_groups_share_students(
        p_delivery_group_id, v_peer.delivery_group_id
      );
    END IF;

    IF v_shared THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_group_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
        'message_en', 'Delivery group / cohort conflict: overlapping session sharing students.',
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object(
          'delivery_group_id', v_peer.delivery_group_id,
          'cohort_id', v_peer.cohort_id,
          'shared_students', true
        )
      ));
    END IF;
  END LOOP;

  RETURN v_conflicts;
END;
$function$;

COMMIT;
