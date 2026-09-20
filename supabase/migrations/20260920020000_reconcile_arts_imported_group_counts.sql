-- User-authorized Arts first-term 2026-2027 reconciliation; preserve published sessions.
CREATE OR REPLACE FUNCTION public.guard_shared_lecture_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_explicit integer;
BEGIN
  IF TG_OP='UPDATE' AND NEW.college_id='d78cf264-3a76-43a1-8601-4d6def12b400'::uuid
  AND OLD.expected_students IS NULL AND OLD.capacity_limit IS NULL
  AND (to_jsonb(NEW)-'expected_students'-'capacity_limit'-'group_number'-'updated_at')
    =(to_jsonb(OLD)-'expected_students'-'capacity_limit'-'group_number'-'updated_at')
  AND EXISTS(SELECT 1 FROM public.academic_cohorts c
    JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id=c.id AND h.term_id=c.term_id
    WHERE c.id=NEW.cohort_id AND c.college_id=NEW.college_id AND c.existing_schedule
      AND c.term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'::uuid AND c.study_system='regular'
      AND h.college_id=c.college_id AND h.approval_status='approved' AND h.scheduling_headcount>0
      AND NEW.expected_students=h.scheduling_headcount
      AND NEW.group_number=1
      AND (SELECT count(*) FROM public.delivery_groups d WHERE d.cohort_id=c.id AND d.component_id=NEW.component_id AND d.active AND NOT d.is_obsolete)=1
      AND NEW.capacity_limit=(public.delivery_group_derivation_status(OLD.id)->>'capacity')::integer
      AND NEW.expected_students<=NEW.capacity_limit)
  THEN
    -- Narrow, one-time completion of unknown imported values; preserve all relationships.
    PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
    IF EXISTS(
      WITH anchors AS (
        SELECT anchor_group_id FROM public.shared_lecture_links WHERE anchor_group_id=OLD.id OR member_group_id=OLD.id
      ), members AS (
        SELECT anchor_group_id,anchor_group_id AS id FROM anchors
        UNION SELECT l.anchor_group_id,l.member_group_id FROM public.shared_lecture_links l JOIN anchors a USING(anchor_group_id)
      ), counts AS (
        SELECT m.anchor_group_id,sum(h.scheduling_headcount) n,
          count(*) FILTER(WHERE h.id IS NULL OR h.scheduling_headcount<=0 OR c.term_id<>'d1844735-b1ee-4c92-acc0-7a529fc43928'::uuid OR c.college_id<>NEW.college_id OR c.study_system<>'regular') bad
        FROM members m JOIN public.delivery_groups d ON d.id=m.id JOIN public.academic_cohorts c ON c.id=d.cohort_id
        LEFT JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id=c.id AND h.term_id=c.term_id AND h.approval_status='approved'
        GROUP BY m.anchor_group_id
      )
      SELECT 1 FROM counts x WHERE x.bad>0 OR x.n IS NULL
       OR NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.delivery_group_id=x.anchor_group_id)
       OR EXISTS(SELECT 1 FROM public.schedule_sessions s LEFT JOIN public.rooms r ON r.id=s.room_id
          WHERE s.delivery_group_id=x.anchor_group_id AND (r.capacity IS NULL OR r.capacity<x.n))
    ) THEN RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_REVIEW_FAILED' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.shared_lecture_links
    WHERE anchor_group_id=OLD.id OR member_group_id=OLD.id
  ) THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514';
    END IF;

    IF NEW.cohort_id IS DISTINCT FROM OLD.cohort_id
       OR NEW.component_id IS DISTINCT FROM OLD.component_id
       OR NEW.plan_course_id IS DISTINCT FROM OLD.plan_course_id
       OR NEW.college_id IS DISTINCT FROM OLD.college_id
       OR NEW.expected_students IS DISTINCT FROM OLD.expected_students
       OR NEW.capacity_limit IS DISTINCT FROM OLD.capacity_limit
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.is_obsolete IS DISTINCT FROM OLD.is_obsolete THEN

      SELECT pcc.explicit_group_size INTO v_explicit
      FROM public.plan_course_components pcc
      WHERE pcc.id=NEW.component_id AND pcc.college_id=NEW.college_id;

      IF NEW.cohort_id IS NOT DISTINCT FROM OLD.cohort_id
         AND NEW.component_id IS NOT DISTINCT FROM OLD.component_id
         AND NEW.plan_course_id IS NOT DISTINCT FROM OLD.plan_course_id
         AND NEW.college_id IS NOT DISTINCT FROM OLD.college_id
         AND NEW.expected_students IS NOT DISTINCT FROM OLD.expected_students
         AND NEW.active IS NOT DISTINCT FROM OLD.active
         AND NEW.is_obsolete IS NOT DISTINCT FROM OLD.is_obsolete
         AND NEW.capacity_limit IS DISTINCT FROM OLD.capacity_limit
         AND v_explicit IS NOT NULL
         AND v_explicit > 0
         AND NEW.capacity_limit = v_explicit THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$
;
UPDATE public.plan_course_components SET explicit_group_size=8
WHERE id='82cc6a27-351c-472a-8ab9-374d3633d554' AND college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND explicit_group_size IS NULL;
WITH estimates AS (
 SELECT g.id,h.scheduling_headcount n,
 count(*) OVER(PARTITION BY g.cohort_id,g.component_id)::integer k,
 row_number() OVER(PARTITION BY g.cohort_id,g.component_id ORDER BY g.group_number,g.id)::integer rn,
 (public.delivery_group_derivation_status(g.id)->>'capacity')::integer cap
 FROM public.delivery_groups g JOIN public.academic_cohorts c ON c.id=g.cohort_id
 JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id=c.id AND h.term_id=c.term_id AND h.approval_status='approved'
 WHERE g.college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND c.term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'
 AND g.active AND NOT g.is_obsolete
)
UPDATE public.delivery_groups g SET expected_students=e.n/e.k+CASE WHEN e.rn<=e.n%e.k THEN 1 ELSE 0 END,
 capacity_limit=e.cap,group_number=e.rn FROM estimates e WHERE g.id=e.id AND g.expected_students IS NULL AND g.capacity_limit IS NULL;
DO $verify$ BEGIN
IF EXISTS(SELECT 1 FROM public.delivery_groups g JOIN public.academic_cohorts c ON c.id=g.cohort_id
 WHERE g.college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND c.term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'
 AND g.active AND NOT g.is_obsolete AND NOT public.delivery_group_is_current(g.id))
THEN RAISE EXCEPTION 'ARTS_GROUP_RECONCILIATION_FAILED'; END IF;
IF (SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY id)) FROM public.schedule_sessions s
 WHERE schedule_version_id='38d198db-a391-437e-8e93-b97914e48002')<>'7da856830b138491390ecef38ab0fae7'
THEN RAISE EXCEPTION 'PUBLISHED_BASELINE_CHANGED'; END IF;
END $verify$;