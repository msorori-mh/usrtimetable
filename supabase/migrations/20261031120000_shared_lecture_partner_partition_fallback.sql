-- Shared lectures merged with merge_version_shared_lecture in a college outside the
-- version-scoped delivery model write partner_group_facts but no partner_partition_facts.
-- schedule_version_student_memberships then hid the current cohort partitions of the
-- anchor and member groups, so coverage looked incomplete and the student daily-hours
-- check fell back to a cohort-wide sum (two tutorial groups at the same hour counted
-- for the same students). Use the current cohort partitions when the version holds
-- no partner partitions for that group. Version-scoped colleges (ITCS) are unchanged.
CREATE OR REPLACE FUNCTION public.schedule_version_student_memberships(p_version uuid, p_groups uuid[])
 RETURNS TABLE(delivery_group_id uuid, cohort_id uuid, partition_id uuid, partition_headcount integer, shared_lecture boolean, expected_students integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'schedule_version_delivery_private', 'pg_temp'
AS $function$
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
    WHERE s.cohort_id IS NULL
      -- A version partner fact without partner partitions (shared lecture merged
      -- in a college outside the version-scoped delivery model) must not hide the
      -- current cohort partitions; otherwise coverage looks incomplete.
      AND (pf.group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM schedule_version_delivery_private.partner_partition_facts pp2
        WHERE pp2.version_id=p_version AND pp2.group_id=m.delivery_group_id))
  ), members AS (
    SELECT r.id,d.cohort_id,d.partition_id,d.headcount,
      EXISTS(SELECT 1 FROM links l WHERE l.anchor_group_id=r.id) AS shared_lecture
    FROM requested r JOIN direct d ON d.group_id=r.id
    UNION ALL
    SELECT l.anchor_group_id,d.cohort_id,d.partition_id,d.headcount,true
    FROM links l JOIN direct d ON d.group_id=l.member_group_id
    UNION ALL
    -- A missing member partition must still expose the shared cohort. Clients
    -- and the server then treat coverage as incomplete and block overlap.
    SELECT l.anchor_group_id,g.cohort_id,NULL::uuid,NULL::integer,true
    FROM links l JOIN public.delivery_groups g ON g.id=l.member_group_id
    WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=g.id)
    UNION ALL
    -- The anchor's own cohort attends the shared lecture too, even when it
    -- has no partition rows of its own.
    SELECT r.id,r.own_cohort,NULL::uuid,NULL::integer,true
    FROM requested r
    WHERE EXISTS (SELECT 1 FROM links l WHERE l.anchor_group_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=r.id)
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
$function$;
