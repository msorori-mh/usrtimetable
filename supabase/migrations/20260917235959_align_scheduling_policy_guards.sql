-- Align persisted scheduling defaults with the current policy and enforce the
-- student 8/6/8 daily caps at the database boundary.

ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS max_daily_theory_hours_per_section integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS max_daily_practical_hours_per_section integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS extended_day_policy_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS standard_day_end_time time NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS max_extended_days_per_partition integer NOT NULL DEFAULT 2;

ALTER TABLE public.scheduling_settings
  ALTER COLUMN day_end_time SET DEFAULT '16:00',
  ALTER COLUMN max_daily_hours_per_instructor SET DEFAULT 8,
  ALTER COLUMN max_daily_hours_per_section SET DEFAULT 8,
  ALTER COLUMN max_daily_theory_hours_per_section SET DEFAULT 6,
  ALTER COLUMN max_daily_practical_hours_per_section SET DEFAULT 8,
  ALTER COLUMN extended_day_policy_enabled SET DEFAULT true,
  ALTER COLUMN standard_day_end_time SET DEFAULT '14:00',
  ALTER COLUMN max_extended_days_per_partition SET DEFAULT 2;

ALTER TABLE public.scheduling_settings
  DROP CONSTRAINT IF EXISTS extended_day_policy_bounds;

ALTER TABLE public.scheduling_settings
  ADD CONSTRAINT extended_day_policy_bounds CHECK (
    max_extended_days_per_partition BETWEEN 0 AND 7
    AND (
      NOT extended_day_policy_enabled
      OR (
        day_start_time < standard_day_end_time
        AND standard_day_end_time <= day_end_time
      )
    )
  );

CREATE OR REPLACE FUNCTION public.schedule_student_daily_loads_for_rows(
  p_college uuid,
  p_version uuid,
  p_rows jsonb
)
RETURNS TABLE(
  student_key text,
  day_of_week integer,
  total_minutes numeric,
  theory_minutes numeric,
  practical_minutes numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
WITH input_rows AS (
  SELECT
    e.id,
    e.college_id,
    e.schedule_version_id,
    e.teaching_assignment_id,
    e.plan_course_component_id,
    e.cohort_id,
    e.delivery_group_id,
    e.day_of_week,
    e.start_time,
    e.end_time,
    e.replaced_by_split
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS e(
    id uuid,
    college_id uuid,
    schedule_version_id uuid,
    teaching_assignment_id uuid,
    plan_course_component_id uuid,
    cohort_id uuid,
    delivery_group_id uuid,
    day_of_week integer,
    start_time time,
    end_time time,
    replaced_by_split boolean
  )
  WHERE e.college_id = p_college
    AND e.schedule_version_id = p_version
    AND NOT COALESCE(e.replaced_by_split, false)
), with_assignment AS (
  SELECT
    r.*,
    ta.cohort_id AS ta_cohort_id,
    ta.delivery_group_id AS ta_delivery_group_id,
    ta.plan_course_component_id AS ta_component_id
  FROM input_rows r
  LEFT JOIN public.teaching_assignments ta
    ON ta.id = r.teaching_assignment_id
   AND ta.college_id = p_college
), source AS (
  SELECT
    a.id,
    COALESCE(a.cohort_id, a.ta_cohort_id, g.cohort_id) AS cohort_id,
    COALESCE(a.delivery_group_id, a.ta_delivery_group_id) AS delivery_group_id,
    COALESCE(a.plan_course_component_id, a.ta_component_id, g.component_id) AS component_id,
    a.day_of_week,
    a.start_time,
    a.end_time
  FROM with_assignment a
  LEFT JOIN public.operational_delivery_groups g
    ON g.id = COALESCE(a.delivery_group_id, a.ta_delivery_group_id)
   AND g.college_id = p_college
), coverage AS (
  SELECT
    g.id,
    g.cohort_id,
    g.expected_students > 0
      AND COUNT(p.id) > 0
      AND COALESCE(SUM(p.headcount), 0) = g.expected_students AS complete,
    ARRAY_AGG(DISTINCT ('partition:' || p.id::text) ORDER BY ('partition:' || p.id::text))
      FILTER (WHERE p.id IS NOT NULL) AS partition_keys
  FROM public.operational_delivery_groups g
  LEFT JOIN public.operational_group_members m
    ON m.delivery_group_id = g.id
   AND m.college_id = p_college
   AND m.cohort_id = g.cohort_id
  LEFT JOIN public.cohort_student_partitions p
    ON p.id = m.partition_id
   AND p.college_id = p_college
   AND p.cohort_id = g.cohort_id
   AND p.active
  WHERE g.college_id = p_college
  GROUP BY g.id, g.cohort_id, g.expected_students
), expanded AS (
  SELECT
    s.id,
    k.student_key,
    s.day_of_week,
    (EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0)::numeric AS duration_minutes,
    CASE
      WHEN LOWER(BTRIM(COALESCE(pcc.component_type::text, ''))) IN
        ('practical', 'lab', 'laboratory', 'عملي', 'معمل', 'مختبر')
      THEN 'practical'
      ELSE 'theory'
    END AS load_kind
  FROM source s
  LEFT JOIN coverage c
    ON c.id = s.delivery_group_id
   AND c.cohort_id = s.cohort_id
  LEFT JOIN public.plan_course_components pcc
    ON pcc.id = s.component_id
   AND pcc.college_id = p_college
  CROSS JOIN LATERAL UNNEST(
    CASE
      WHEN c.complete IS TRUE AND CARDINALITY(c.partition_keys) > 0
        THEN c.partition_keys
      ELSE ARRAY['cohort:' || COALESCE(s.cohort_id::text, 'unknown')]
    END
  ) AS k(student_key)
  WHERE s.day_of_week IS NOT NULL
    AND s.start_time IS NOT NULL
    AND s.end_time IS NOT NULL
    AND s.end_time > s.start_time
), dedup AS (
  SELECT DISTINCT
    id,
    student_key,
    day_of_week,
    duration_minutes,
    load_kind
  FROM expanded
)
SELECT
  student_key,
  day_of_week,
  SUM(duration_minutes)::numeric AS total_minutes,
  COALESCE(SUM(duration_minutes) FILTER (WHERE load_kind = 'theory'), 0)::numeric AS theory_minutes,
  COALESCE(SUM(duration_minutes) FILTER (WHERE load_kind = 'practical'), 0)::numeric AS practical_minutes
FROM dedup
GROUP BY student_key, day_of_week;
$fn$;

REVOKE ALL ON FUNCTION public.schedule_student_daily_loads_for_rows(uuid,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._enforce_student_daily_load_pair(
  p_college uuid,
  p_version uuid,
  p_before jsonb,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_total_hours numeric := 8;
  v_theory_hours numeric := 6;
  v_practical_hours numeric := 8;
  v_conflict record;
BEGIN
  SELECT
    CASE WHEN s.max_daily_hours_per_section > 0
      THEN s.max_daily_hours_per_section::numeric ELSE 8::numeric END,
    CASE WHEN s.max_daily_theory_hours_per_section > 0
      THEN s.max_daily_theory_hours_per_section::numeric
      ELSE CASE WHEN s.max_daily_hours_per_section > 0
        THEN s.max_daily_hours_per_section::numeric ELSE 8::numeric END END,
    CASE WHEN s.max_daily_practical_hours_per_section > 0
      THEN s.max_daily_practical_hours_per_section::numeric
      ELSE CASE WHEN s.max_daily_hours_per_section > 0
        THEN s.max_daily_hours_per_section::numeric ELSE 8::numeric END END
  INTO v_total_hours, v_theory_hours, v_practical_hours
  FROM public.scheduling_settings s
  WHERE s.college_id = p_college
  LIMIT 1;

  IF NOT FOUND THEN
    v_total_hours := 8;
    v_theory_hours := 6;
    v_practical_hours := 8;
  END IF;

  v_theory_hours := LEAST(v_total_hours, v_theory_hours);
  v_practical_hours := LEAST(v_total_hours, v_practical_hours);

  SELECT
    a.student_key,
    a.day_of_week,
    a.total_minutes,
    a.theory_minutes,
    a.practical_minutes,
    COALESCE(b.total_minutes, 0) AS before_total_minutes,
    COALESCE(b.theory_minutes, 0) AS before_theory_minutes,
    COALESCE(b.practical_minutes, 0) AS before_practical_minutes
  INTO v_conflict
  FROM public.schedule_student_daily_loads_for_rows(p_college, p_version, p_after) a
  LEFT JOIN public.schedule_student_daily_loads_for_rows(p_college, p_version, p_before) b
    USING (student_key, day_of_week)
  WHERE a.total_minutes > GREATEST(v_total_hours * 60, COALESCE(b.total_minutes, 0))
     OR a.theory_minutes > GREATEST(v_theory_hours * 60, COALESCE(b.theory_minutes, 0))
     OR a.practical_minutes > GREATEST(v_practical_hours * 60, COALESCE(b.practical_minutes, 0))
  ORDER BY a.day_of_week, a.student_key
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'STUDENT_DAILY_LOAD_LIMIT'
      USING ERRCODE = '23514',
            DETAIL = format(
              'student_key=%s day=%s total=%s/%s theory=%s/%s practical=%s/%s minutes',
              v_conflict.student_key,
              v_conflict.day_of_week,
              v_conflict.total_minutes,
              v_total_hours * 60,
              v_conflict.theory_minutes,
              v_theory_hours * 60,
              v_conflict.practical_minutes,
              v_practical_hours * 60
            );
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public._enforce_student_daily_load_pair(uuid,uuid,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_student_daily_load_statement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_scope record;
  v_before jsonb;
  v_after jsonb;
BEGIN
  FOR v_scope IN
    SELECT DISTINCT n.college_id, n.schedule_version_id
    FROM new_sessions n
    WHERE n.college_id IS NOT NULL AND n.schedule_version_id IS NOT NULL
    ORDER BY n.schedule_version_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.schedule_version_id::text, 9175));

    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      INTO v_after
    FROM public.schedule_sessions s
    WHERE s.college_id = v_scope.college_id
      AND s.schedule_version_id = v_scope.schedule_version_id;

    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      INTO v_before
    FROM public.schedule_sessions s
    WHERE s.college_id = v_scope.college_id
      AND s.schedule_version_id = v_scope.schedule_version_id
      AND NOT EXISTS (SELECT 1 FROM new_sessions n WHERE n.id = s.id);

    PERFORM public._enforce_student_daily_load_pair(
      v_scope.college_id,
      v_scope.schedule_version_id,
      v_before,
      v_after
    );
  END LOOP;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_student_daily_load_statement_insert() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_student_daily_load_statement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_scope record;
  v_before jsonb;
  v_after jsonb;
BEGIN
  FOR v_scope IN
    SELECT DISTINCT q.college_id, q.schedule_version_id
    FROM (
      SELECT n.college_id, n.schedule_version_id FROM new_sessions n
      UNION
      SELECT o.college_id, o.schedule_version_id FROM old_sessions o
    ) q
    WHERE q.college_id IS NOT NULL AND q.schedule_version_id IS NOT NULL
    ORDER BY q.schedule_version_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.schedule_version_id::text, 9175));

    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      INTO v_after
    FROM public.schedule_sessions s
    WHERE s.college_id = v_scope.college_id
      AND s.schedule_version_id = v_scope.schedule_version_id;

    SELECT COALESCE(jsonb_agg(r.payload ORDER BY r.id), '[]'::jsonb)
      INTO v_before
    FROM (
      SELECT s.id, to_jsonb(s) AS payload
      FROM public.schedule_sessions s
      WHERE s.college_id = v_scope.college_id
        AND s.schedule_version_id = v_scope.schedule_version_id
        AND NOT EXISTS (SELECT 1 FROM new_sessions n WHERE n.id = s.id)
      UNION ALL
      SELECT o.id, to_jsonb(o) AS payload
      FROM old_sessions o
      WHERE o.college_id = v_scope.college_id
        AND o.schedule_version_id = v_scope.schedule_version_id
    ) r;

    PERFORM public._enforce_student_daily_load_pair(
      v_scope.college_id,
      v_scope.schedule_version_id,
      v_before,
      v_after
    );
  END LOOP;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_student_daily_load_statement_update() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_student_daily_load_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rows jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 9175));

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
    INTO v_rows
  FROM public.schedule_sessions s
  WHERE s.college_id = NEW.college_id
    AND s.schedule_version_id = NEW.id;

  PERFORM public._enforce_student_daily_load_pair(
    NEW.college_id,
    NEW.id,
    '[]'::jsonb,
    v_rows
  );

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_student_daily_load_publication() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ss_student_daily_load_insert ON public.schedule_sessions;
CREATE TRIGGER trg_ss_student_daily_load_insert
AFTER INSERT ON public.schedule_sessions
REFERENCING NEW TABLE AS new_sessions
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_student_daily_load_statement_insert();

DROP TRIGGER IF EXISTS trg_ss_student_daily_load_update ON public.schedule_sessions;
CREATE TRIGGER trg_ss_student_daily_load_update
AFTER UPDATE ON public.schedule_sessions
REFERENCING OLD TABLE AS old_sessions NEW TABLE AS new_sessions
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_student_daily_load_statement_update();

DROP TRIGGER IF EXISTS trg_sv_student_daily_load_publication ON public.schedule_versions;
CREATE TRIGGER trg_sv_student_daily_load_publication
BEFORE UPDATE OF status ON public.schedule_versions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_student_daily_load_publication();
