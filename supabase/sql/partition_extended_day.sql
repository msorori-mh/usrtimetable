-- Additive extended-day policy. New colleges default to the current scheduling policy.
ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS extended_day_policy_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS standard_day_end_time time NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS max_extended_days_per_partition integer NOT NULL DEFAULT 2;

-- ADD COLUMN IF NOT EXISTS does not repair defaults on schemas where these
-- columns already exist, so keep the canonical source aligned with migration defaults.
ALTER TABLE public.scheduling_settings
  ALTER COLUMN day_end_time SET DEFAULT '16:00',
  ALTER COLUMN extended_day_policy_enabled SET DEFAULT true,
  ALTER COLUMN standard_day_end_time SET DEFAULT '14:00',
  ALTER COLUMN max_extended_days_per_partition SET DEFAULT 2;

CREATE OR REPLACE FUNCTION public.schedule_extended_day_counts(
  p_college uuid, p_version uuid, p_omit uuid DEFAULT NULL, p_extra jsonb DEFAULT NULL
) RETURNS TABLE(student_key text, days bigint)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $fn$
  WITH source AS (
    SELECT s.id,s.cohort_id,s.delivery_group_id,s.day_of_week,s.end_time
    FROM public.schedule_sessions s
    WHERE s.college_id=p_college AND s.schedule_version_id=p_version
      AND NOT coalesce(s.replaced_by_split,false) AND s.id IS DISTINCT FROM p_omit
    UNION ALL
    SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
    FROM jsonb_to_record(p_extra) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time)
    WHERE p_extra IS NOT NULL
  ), coverage AS (
    SELECT g.id,g.cohort_id,g.active,g.is_obsolete,
      g.expected_students > 0 AND count(p.id)>0 AND sum(p.headcount)=g.expected_students AS complete,
      array_agg(DISTINCT p.id::text) FILTER(WHERE p.id IS NOT NULL) AS keys
    FROM public.delivery_groups g
    LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id=g.id AND m.college_id=p_college AND m.cohort_id=g.cohort_id
    LEFT JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.college_id=p_college AND p.cohort_id=g.cohort_id AND p.active
    WHERE g.college_id=p_college GROUP BY g.id,g.cohort_id,g.active,g.is_obsolete,g.expected_students
  ), fallback AS (
    SELECT c.cohort_id FROM coverage c WHERE c.active IS DISTINCT FROM false AND NOT coalesce(c.is_obsolete,false) AND c.complete IS DISTINCT FROM true
    UNION
    SELECT s.cohort_id FROM source s LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id WHERE c.complete IS DISTINCT FROM true
  ), expanded AS (
    SELECT s.day_of_week,unnest(CASE WHEN f.cohort_id IS NOT NULL OR c.complete IS DISTINCT FROM true
      THEN ARRAY['cohort:'||coalesce(s.cohort_id::text,'unknown')] ELSE c.keys END) AS key
    FROM source s
    LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id
    LEFT JOIN fallback f ON f.cohort_id=s.cohort_id
    JOIN public.scheduling_settings settings ON settings.college_id=p_college
    WHERE s.end_time>settings.standard_day_end_time
  ) SELECT key,count(DISTINCT day_of_week) FROM expanded GROUP BY key;
$fn$;
REVOKE ALL ON FUNCTION public.schedule_extended_day_counts(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_extended_day_counts(uuid,uuid,uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_partition_extended_day()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE settings public.scheduling_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings FROM public.scheduling_settings WHERE college_id=NEW.college_id;
  IF NOT coalesce(settings.extended_day_policy_enabled,false) THEN RETURN NEW; END IF;
  -- Same version lock as the existing lifecycle writer; never disable existing guards.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.schedule_version_id::text,9174));
  IF NEW.end_time>settings.standard_day_end_time AND NEW.cohort_id IS NULL THEN
    RAISE EXCEPTION 'EXTENDED_DAY_STUDENT_MAPPING_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schedule_extended_day_counts(NEW.college_id,NEW.schedule_version_id,
      NEW.id,CASE WHEN coalesce(NEW.replaced_by_split,false) THEN NULL ELSE to_jsonb(NEW) END) after_counts
    LEFT JOIN public.schedule_extended_day_counts(NEW.college_id,NEW.schedule_version_id) before_counts USING(student_key)
    WHERE after_counts.days>greatest(settings.max_extended_days_per_partition,coalesce(before_counts.days,0))
  ) THEN
    RAISE EXCEPTION 'PARTITION_EXTENDED_DAY_LIMIT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_partition_extended_day() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.enforce_extended_day_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE settings public.scheduling_settings%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'published' THEN RETURN NEW; END IF;
  SELECT * INTO settings FROM public.scheduling_settings WHERE college_id=NEW.college_id;
  IF coalesce(settings.extended_day_policy_enabled,false) AND EXISTS (
    SELECT 1 FROM public.schedule_extended_day_counts(NEW.college_id,NEW.id)
    WHERE days>settings.max_extended_days_per_partition
  ) THEN
    RAISE EXCEPTION 'PARTITION_EXTENDED_DAY_LIMIT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_extended_day_publication() FROM PUBLIC,anon,authenticated;

DO $install$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.scheduling_settings'::regclass AND conname='extended_day_policy_bounds') THEN
    ALTER TABLE public.scheduling_settings ADD CONSTRAINT extended_day_policy_bounds CHECK (
      max_extended_days_per_partition BETWEEN 0 AND 7 AND
      (NOT extended_day_policy_enabled OR (day_start_time < standard_day_end_time AND standard_day_end_time <= day_end_time))
    );
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.schedule_sessions'::regclass AND tgname='trg_ss_partition_extended_day') THEN
    CREATE TRIGGER trg_ss_partition_extended_day BEFORE INSERT OR UPDATE ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_partition_extended_day();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.schedule_versions'::regclass AND tgname='trg_sv_extended_day_publication') THEN
    CREATE TRIGGER trg_sv_extended_day_publication BEFORE UPDATE OF status ON public.schedule_versions FOR EACH ROW EXECUTE FUNCTION public.enforce_extended_day_publication();
  END IF;
END;
$install$;
