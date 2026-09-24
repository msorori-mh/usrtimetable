CREATE OR REPLACE FUNCTION public.guard_shared_lecture_cohort()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE cid uuid; j jsonb; o jsonb; a uuid; n bigint; missing bigint; cap integer; group_cap integer;
BEGIN
 o:=to_jsonb(OLD); j:=to_jsonb(NEW);
 cid:=(o->>CASE WHEN TG_TABLE_NAME='academic_cohorts' THEN 'id' ELSE 'cohort_id' END)::uuid;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id IN(l.anchor_group_id,l.member_group_id) WHERE g.cohort_id=cid)
 AND (TG_OP='DELETE' OR (j-'updated_at'-'notes'-'source') IS DISTINCT FROM (o-'updated_at'-'notes'-'source')) THEN
   -- User-authorized transitional approval, Arts first term 2026-2027 only.
   -- No count edits, unlinking, or authentication bypass.
   IF TG_TABLE_NAME='scheduling_cohort_term_headcounts' AND TG_OP='UPDATE'
     AND j->>'college_id'='d78cf264-3a76-43a1-8601-4d6def12b400'
     AND j->>'term_id'='d1844735-b1ee-4c92-acc0-7a529fc43928'
     AND j->>'study_system'='regular'
     AND o->>'approval_status'='draft' AND j->>'approval_status'='approved'
     AND auth.uid() IS NOT NULL
     AND j->>'approved_by'=auth.uid()::text
     AND public.can_manage_college(auth.uid(),(j->>'college_id')::uuid)
     AND (j-'updated_at'-'notes'-'source'-'approval_status'-'approved_by'-'approved_at')
       = (o-'updated_at'-'notes'-'source'-'approval_status'-'approved_by'-'approved_at')
     AND EXISTS(SELECT 1 FROM public.academic_cohorts c WHERE c.id=cid AND c.existing_schedule
       AND c.college_id=(j->>'college_id')::uuid AND c.term_id=(j->>'term_id')::uuid AND c.study_system='regular')
   THEN
     PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
     FOR a IN SELECT DISTINCT l.anchor_group_id FROM public.shared_lecture_links l
       JOIN public.delivery_groups g ON g.id IN(l.anchor_group_id,l.member_group_id) WHERE g.cohort_id=cid
     LOOP
       WITH members AS (
         SELECT a AS id UNION SELECT member_group_id FROM public.shared_lecture_links WHERE anchor_group_id=a
       ), cohorts AS (
         SELECT DISTINCT g.cohort_id FROM members m JOIN public.delivery_groups g ON g.id=m.id
       )
       SELECT sum(h.scheduling_headcount),count(*) FILTER(WHERE h.id IS NULL OR h.scheduling_headcount<=0
         OR c.college_id IS DISTINCT FROM (j->>'college_id')::uuid
         OR c.term_id IS DISTINCT FROM (j->>'term_id')::uuid
         OR c.study_system IS DISTINCT FROM 'regular' OR NOT c.existing_schedule)
       INTO n,missing FROM cohorts x LEFT JOIN public.academic_cohorts c ON c.id=x.cohort_id
       LEFT JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id=c.id
         AND h.term_id=(j->>'term_id')::uuid AND h.college_id=(j->>'college_id')::uuid AND h.study_system='regular';
       IF missing>0 OR n IS NULL THEN
         RAISE EXCEPTION 'SHARED_LECTURE_HEADCOUNT_MISSING: %',a USING ERRCODE='23514';
       END IF;
       SELECT min(r.capacity) INTO cap FROM public.schedule_sessions s LEFT JOIN public.rooms r ON r.id=s.room_id
       WHERE s.delivery_group_id=a;
       IF cap IS NULL OR cap<=0 OR EXISTS(SELECT 1 FROM public.schedule_sessions s LEFT JOIN public.rooms r ON r.id=s.room_id
         WHERE s.delivery_group_id=a AND (r.capacity IS NULL OR r.capacity<=0)) THEN
         RAISE EXCEPTION 'SHARED_LECTURE_ROOM_CAPACITY_UNKNOWN: %',a USING ERRCODE='23514';
       END IF;
       SELECT min(g.capacity_limit) INTO group_cap FROM public.delivery_groups g
       WHERE g.id=a OR g.id IN(SELECT member_group_id FROM public.shared_lecture_links WHERE anchor_group_id=a);
       IF n>cap OR (group_cap IS NOT NULL AND n>group_cap) THEN
         RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_EXCEEDED: group %, students %, room %, group limit %',a,n,cap,group_cap USING ERRCODE='23514';
       END IF;
     END LOOP;
     RETURN NEW;
   END IF;
   RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$;