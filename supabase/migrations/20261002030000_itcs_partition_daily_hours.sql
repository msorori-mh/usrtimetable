-- Count contact hours for each registered student partition, rather than adding
-- every independent practical group in the cohort. Only the ITCS V2 caller uses
-- this helper; limits and grandfathering retain their existing meanings.
CREATE OR REPLACE FUNCTION public._ss_partition_daily_hours(
 p_sid uuid,p_group uuid,p_cohort uuid,p_kind text,p_dow integer,p_proposed numeric,
 p_total_limit numeric,p_theory_limit numeric,p_practical_limit numeric,
 p_members jsonb,p_rows jsonb
) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $fn$
WITH members AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset(p_members) m(
  delivery_group_id uuid,cohort_id uuid,partition_id uuid,
  partition_headcount integer,expected_students integer)
), rows AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset(p_rows) s(
  id uuid,delivery_group_id uuid,cohort_id uuid,kind text,hours numeric)
), coverage AS (
 SELECT delivery_group_id,max(expected_students) expected_students,
  sum(partition_headcount) headcount,count(*) n,
  count(DISTINCT partition_id) partitions,
  bool_and(partition_id IS NOT NULL AND partition_headcount>0) valid
 FROM members GROUP BY delivery_group_id
), own AS MATERIALIZED (
 SELECT DISTINCT cohort_id,partition_id FROM members WHERE delivery_group_id=p_group
), bad AS (
 SELECT 1 WHERE NOT EXISTS(
  SELECT 1 FROM coverage WHERE delivery_group_id=p_group AND valid
   AND expected_students>0 AND headcount=expected_students AND n=partitions)
 UNION ALL
 SELECT 1 FROM rows s LEFT JOIN coverage c ON c.delivery_group_id=s.delivery_group_id
 WHERE (s.cohort_id=p_cohort OR EXISTS(
   SELECT 1 FROM members m JOIN own o USING(cohort_id)
   WHERE m.delivery_group_id=s.delivery_group_id))
  AND (c.delivery_group_id IS NULL OR NOT coalesce(c.valid,false)
   OR c.expected_students<=0 OR c.headcount IS DISTINCT FROM c.expected_students
   OR c.n IS DISTINCT FROM c.partitions)
), contact AS MATERIALIZED (
 SELECT DISTINCT o.partition_id,s.id,s.kind,s.hours
 FROM own o JOIN members m USING(partition_id)
 JOIN rows s ON s.delivery_group_id=m.delivery_group_id
), totals AS (
 SELECT o.partition_id,
  coalesce(sum(c.hours) FILTER(WHERE c.id IS DISTINCT FROM p_sid),0) existing_total,
  coalesce(sum(c.hours) FILTER(WHERE c.id IS DISTINCT FROM p_sid AND c.kind='theory'),0) existing_theory,
  coalesce(sum(c.hours) FILTER(WHERE c.id IS DISTINCT FROM p_sid AND c.kind='practical'),0) existing_practical,
  coalesce(sum(c.hours),0) prior_total,
  coalesce(sum(c.hours) FILTER(WHERE c.kind='theory'),0) prior_theory,
  coalesce(sum(c.hours) FILTER(WHERE c.kind='practical'),0) prior_practical
 FROM own o LEFT JOIN contact c USING(partition_id) GROUP BY o.partition_id
), exceeded AS (
 SELECT partition_id,'student_daily_hours' code,existing_total+p_proposed next_hours,
  p_total_limit limit_hours FROM totals
 WHERE existing_total+p_proposed>greatest(p_total_limit,prior_total)
 UNION ALL
 SELECT partition_id,'student_daily_theory_hours',existing_theory+p_proposed,
  p_theory_limit FROM totals WHERE p_kind='theory'
  AND existing_theory+p_proposed>greatest(p_theory_limit,prior_theory)
 UNION ALL
 SELECT partition_id,'student_daily_practical_hours',existing_practical+p_proposed,
  p_practical_limit FROM totals WHERE p_kind='practical'
  AND existing_practical+p_proposed>greatest(p_practical_limit,prior_practical)
)
SELECT CASE WHEN EXISTS(SELECT 1 FROM bad) THEN
 jsonb_build_array(public._ss_ci('student_daily_hours','hard',p_sid,NULL,
  jsonb_build_object('reason','student_mapping_incomplete','delivery_group_id',p_group,
   'cohort_id',p_cohort,'day_of_week',p_dow)))
 ELSE coalesce((SELECT jsonb_agg(public._ss_ci(code,'hard',p_sid,NULL,
  jsonb_build_object('partition_id',partition_id,'delivery_group_id',p_group,
   'cohort_id',p_cohort,'day_of_week',p_dow,'next_hours',next_hours,'limit_hours',limit_hours)))
  FROM exceeded),'[]'::jsonb) END
$fn$;
REVOKE ALL ON FUNCTION public._ss_partition_daily_hours(uuid,uuid,uuid,text,integer,numeric,numeric,numeric,numeric,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._ss_partition_daily_hours(uuid,uuid,uuid,text,integer,numeric,numeric,numeric,numeric,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._ss_student_daily_hours(p_sid uuid, p_cid uuid, p_vid uuid, p_section_id uuid, p_ta_id uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_cohort_id uuid;
  v_delivery_group_id uuid;
  v_kind text := 'theory';
  v_total_limit numeric := 8;
  v_theory_limit numeric := 6;
  v_practical_limit numeric := 8;
  v_proposed numeric := extract(epoch FROM (p_et - p_st)) / 3600;
  v_existing_total numeric := 0;
  v_existing_theory numeric := 0;
  v_existing_practical numeric := 0;
  v_prior_total numeric := 0;
  v_prior_theory numeric := 0;
  v_prior_practical numeric := 0;
  v_next_total numeric;
  v_next_kind numeric;
  v_partition_groups uuid[];
  v_partition_members jsonb;
  v_partition_rows jsonb;
BEGIN
  SELECT ta.cohort_id, ta.delivery_group_id,
         CASE WHEN lower(coalesce(pcc.component_type, ta.session_type, ''))
                    IN ('practical', 'lab', 'laboratory')
              THEN 'practical' ELSE 'theory' END
    INTO v_cohort_id, v_delivery_group_id, v_kind
  FROM public.teaching_assignments ta
  LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
  WHERE ta.id = p_ta_id;

  IF p_section_id IS NULL AND v_cohort_id IS NULL AND v_delivery_group_id IS NULL THEN
    RETURN v;
  END IF;

  SELECT coalesce(cfg.max_daily_hours_per_section, 8),
         least(coalesce(cfg.max_daily_theory_hours_per_section,
                        cfg.max_daily_hours_per_section, 8),
               coalesce(cfg.max_daily_hours_per_section, 8)),
         least(coalesce(cfg.max_daily_practical_hours_per_section,
                        cfg.max_daily_hours_per_section, 8),
               coalesce(cfg.max_daily_hours_per_section, 8))
    INTO v_total_limit, v_theory_limit, v_practical_limit
  FROM public.scheduling_settings cfg
  WHERE cfg.college_id = p_cid;
  v_total_limit := coalesce(v_total_limit, 8);
  v_theory_limit := least(coalesce(v_theory_limit, v_total_limit), v_total_limit);
  v_practical_limit := least(coalesce(v_practical_limit, v_total_limit), v_total_limit);


  -- ITCS V2 students are identified by version-scoped partitions, including
  -- merged lectures. A different practical group's hours are not theirs.
  IF v_delivery_group_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.colleges c WHERE c.id=p_cid AND c.code='ITCS'
  ) THEN
    SELECT array_agg(DISTINCT g) INTO v_partition_groups FROM (
      SELECT v_delivery_group_id g
      UNION ALL
      SELECT s.delivery_group_id FROM public.schedule_sessions s
      WHERE s.college_id=p_cid AND s.schedule_version_id=p_vid
        AND s.day_of_week=p_dow AND NOT coalesce(s.replaced_by_split,false)
        AND s.delivery_group_id IS NOT NULL
    ) groups;
    IF cardinality(v_partition_groups)>100 THEN
      RETURN jsonb_build_array(public._ss_ci('student_daily_hours','hard',p_sid,NULL,
        jsonb_build_object('reason','student_mapping_batch_limit')));
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) INTO v_partition_members
    FROM public.schedule_version_student_memberships(p_vid,v_partition_groups) m;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'delivery_group_id',s.delivery_group_id,'cohort_id',s.cohort_id,
      'hours',extract(epoch FROM(s.end_time-s.start_time))/3600,
      'kind',CASE WHEN lower(coalesce(pcc.component_type,ta.session_type,s.session_type,''))
        IN('practical','lab','laboratory') THEN 'practical' ELSE 'theory' END
    )),'[]'::jsonb) INTO v_partition_rows
    FROM public.schedule_sessions s
    LEFT JOIN public.teaching_assignments ta ON ta.id=s.teaching_assignment_id
    LEFT JOIN public.plan_course_components pcc ON pcc.id=ta.plan_course_component_id
    WHERE s.college_id=p_cid AND s.schedule_version_id=p_vid
      AND s.day_of_week=p_dow AND NOT coalesce(s.replaced_by_split,false);
    RETURN public._ss_partition_daily_hours(p_sid,v_delivery_group_id,v_cohort_id,
      v_kind,p_dow,v_proposed,v_total_limit,v_theory_limit,v_practical_limit,
      v_partition_members,v_partition_rows);
  END IF;

  WITH relevant AS (
    SELECT s.id,
      extract(epoch FROM (s.end_time - s.start_time)) / 3600 AS hours,
      CASE WHEN lower(coalesce(pcc.component_type, ta.session_type, s.session_type, ''))
                   IN ('practical', 'lab', 'laboratory')
        THEN 'practical' ELSE 'theory' END AS kind
    FROM public.schedule_sessions s
    LEFT JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
    LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
    WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
      AND s.day_of_week = p_dow AND NOT coalesce(s.replaced_by_split, false)
      AND (
        (p_section_id IS NOT NULL AND s.section_id = p_section_id)
        OR (v_cohort_id IS NOT NULL AND s.cohort_id = v_cohort_id)
        OR (v_delivery_group_id IS NOT NULL AND s.delivery_group_id = v_delivery_group_id)
      )
  )
  SELECT
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid), 0),
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid AND kind = 'theory'), 0),
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid AND kind = 'practical'), 0),
    coalesce(sum(hours), 0),
    coalesce(sum(hours) FILTER (WHERE kind = 'theory'), 0),
    coalesce(sum(hours) FILTER (WHERE kind = 'practical'), 0)
  INTO v_existing_total, v_existing_theory, v_existing_practical,
       v_prior_total, v_prior_theory, v_prior_practical
  FROM relevant;

  v_next_total := v_existing_total + v_proposed;
  v_next_kind := CASE WHEN v_kind = 'practical'
    THEN v_existing_practical + v_proposed
    ELSE v_existing_theory + v_proposed END;

  IF v_next_total > greatest(v_total_limit, v_prior_total) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_total,
        'limit_hours', v_total_limit, 'cohort_id', v_cohort_id,
        'delivery_group_id', v_delivery_group_id, 'section_id', p_section_id)
    ));
  END IF;
  IF v_kind = 'practical'
     AND v_next_kind > greatest(v_practical_limit, v_prior_practical) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_practical_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_kind,
        'limit_hours', v_practical_limit)
    ));
  ELSIF v_kind = 'theory'
     AND v_next_kind > greatest(v_theory_limit, v_prior_theory) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_theory_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_kind,
        'limit_hours', v_theory_limit)
    ));
  END IF;
  RETURN v;
END;
$function$
;
