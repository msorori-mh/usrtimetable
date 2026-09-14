-- Apply this entire file in one transaction after partition_extended_day.sql.
-- Final-statement validation supports atomic swaps without disabling any guard.
CREATE OR REPLACE FUNCTION public.schedule_extended_counts_for_rows(p_college uuid,p_rows jsonb)
RETURNS TABLE(student_key text,days bigint)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $fn$
 WITH source AS (
 SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
 FROM jsonb_to_recordset(p_rows) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time,replaced_by_split boolean)
 WHERE NOT coalesce(e.replaced_by_split,false)
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
REVOKE ALL ON FUNCTION public.schedule_extended_counts_for_rows(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_extended_counts_for_rows(uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_partition_extended_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_scope record; v_settings public.scheduling_settings%ROWTYPE;
 v_before jsonb; v_after jsonb; v_old jsonb := '[]'::jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO v_old FROM old_sessions o; END IF;
 FOR v_scope IN SELECT DISTINCT college_id,schedule_version_id FROM new_sessions ORDER BY schedule_version_id LOOP
  SELECT * INTO v_settings FROM public.scheduling_settings WHERE college_id=v_scope.college_id;
  IF NOT coalesce(v_settings.extended_day_policy_enabled,false) THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.schedule_version_id::text,9174));
  IF EXISTS(SELECT 1 FROM new_sessions n WHERE n.college_id=v_scope.college_id AND n.schedule_version_id=v_scope.schedule_version_id
   AND NOT coalesce(n.replaced_by_split,false) AND n.end_time>v_settings.standard_day_end_time AND n.cohort_id IS NULL) THEN
   RAISE EXCEPTION 'EXTENDED_DAY_STUDENT_MAPPING_REQUIRED' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) INTO v_after FROM public.schedule_sessions s
   WHERE s.college_id=v_scope.college_id AND s.schedule_version_id=v_scope.schedule_version_id;
  SELECT coalesce(jsonb_agg(e),'[]'::jsonb) INTO v_before FROM (
   SELECT e FROM jsonb_array_elements(v_after) e WHERE NOT EXISTS(SELECT 1 FROM new_sessions n WHERE n.id=(e->>'id')::uuid)
   UNION ALL
   SELECT e FROM jsonb_array_elements(v_old) e WHERE (e->>'college_id')::uuid=v_scope.college_id AND (e->>'schedule_version_id')::uuid=v_scope.schedule_version_id
  ) reconstructed;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_counts_for_rows(v_scope.college_id,v_after) a
   LEFT JOIN public.schedule_extended_counts_for_rows(v_scope.college_id,v_before) b USING(student_key)
   WHERE a.days>greatest(v_settings.max_extended_days_per_partition,coalesce(b.days,0))) THEN
   RAISE EXCEPTION 'PARTITION_EXTENDED_DAY_LIMIT' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_partition_extended_statement() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_ss_partition_extended_day ON public.schedule_sessions;
CREATE TRIGGER trg_ss_partition_extended_insert AFTER INSERT ON public.schedule_sessions
 REFERENCING NEW TABLE AS new_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_partition_extended_statement();
CREATE TRIGGER trg_ss_partition_extended_update AFTER UPDATE ON public.schedule_sessions
 REFERENCING OLD TABLE AS old_sessions NEW TABLE AS new_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_partition_extended_statement();
