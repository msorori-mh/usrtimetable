BEGIN;
-- An approved manual reassignment may restore an existing historical root.
-- Preserve historical sessions and version relationships. The explicit current
-- choice expires at the next promotion for this college/term, and never leaks
-- into a projected version promotion.
CREATE TABLE assignment_version_private.manual_restorations (
  assignment_id uuid PRIMARY KEY REFERENCES public.teaching_assignments(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  term_id uuid NOT NULL REFERENCES public.academic_terms(id),
  promotion_watermark timestamptz,
  restored_at timestamptz NOT NULL DEFAULT now(),
  restored_by uuid NOT NULL,
  request_id uuid REFERENCES public.faculty_teaching_requests(id)
);
ALTER TABLE assignment_version_private.manual_restorations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON assignment_version_private.manual_restorations FROM PUBLIC, anon, authenticated;

CREATE FUNCTION assignment_version_private.promotion_watermark(p_college uuid,p_term uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(p.promoted_at)
 FROM assignment_version_private.promotions p JOIN public.schedule_versions v ON v.id=p.version_id
 WHERE v.college_id=p_college AND v.academic_term_id=p_term
$$;
CREATE FUNCTION assignment_version_private.manual_restoration_counts(p_assignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(
   SELECT 1 FROM assignment_version_private.manual_restorations r
   WHERE r.assignment_id=p_assignment
     AND r.promotion_watermark IS NOT DISTINCT FROM assignment_version_private.promotion_watermark(r.college_id,r.term_id)
     AND NOT EXISTS(
       SELECT 1 FROM public.schedule_versions v
       WHERE v.id::text=coalesce(current_setting('app.assume_promoted_version',true),'')
         AND v.college_id=r.college_id AND v.academic_term_id=r.term_id
     )
 )
$$;
REVOKE ALL ON FUNCTION assignment_version_private.promotion_watermark(uuid,uuid),
  assignment_version_private.manual_restoration_counts(uuid) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE d text; old_text text; new_text text;
BEGIN
 d:=pg_get_functiondef('assignment_version_private.is_counted(uuid)'::regprocedure);
 IF position('manual_restoration_counts' IN d)>0 OR
    (length(d)-length(replace(d,'SELECT CASE','')))/length('SELECT CASE')<>1 THEN
   RAISE EXCEPTION 'MANUAL_RESTORATION_POLICY_DRIFT';
 END IF;
 EXECUTE replace(d,'SELECT CASE','SELECT CASE WHEN assignment_version_private.manual_restoration_counts(a) THEN true');

 d:=pg_get_functiondef('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)'::regprocedure);
 old_text:='IF v_existing.id IS NOT NULL AND v_existing.is_active THEN';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
   RAISE EXCEPTION 'MANUAL_RESTORATION_WRITER_DRIFT';
 END IF;
 d:=replace(d,old_text,'IF v_existing.id IS NOT NULL AND v_existing.is_active AND assignment_version_private.is_counted(v_existing.id) THEN');
 old_text:='ELSIF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
   RAISE EXCEPTION 'MANUAL_RESTORATION_BRANCH_DRIFT';
 END IF;
 new_text:=$restore$ELSIF v_existing.id IS NOT NULL THEN
    IF NOT assignment_version_private.is_counted(v_existing.id) THEN
      IF v_existing.scope_version_id IS NOT NULL THEN
        RAISE EXCEPTION 'SCOPED_ASSIGNMENT_RESTORATION_FORBIDDEN';
      END IF;
      INSERT INTO assignment_version_private.manual_restorations(
        assignment_id,college_id,term_id,promotion_watermark,restored_by,request_id
      )
      SELECT v_existing.id,v_dg.college_id,o.term_id,
        assignment_version_private.promotion_watermark(v_dg.college_id,o.term_id),v_uid,r.id
      FROM public.course_offerings o
      LEFT JOIN LATERAL (
        SELECT q.id FROM public.faculty_teaching_requests q
        WHERE q.college_id=v_dg.college_id AND q.term_id=o.term_id
          AND q.delivery_group_id=p_delivery_group_id AND q.instructor_id=p_instructor_id
          AND q.status='approved' AND q.decided_by=v_uid AND q.decided_at=now()
          AND q.assignment_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM assignment_version_private.request_scope rs WHERE rs.request_id=q.id)
        LIMIT 1
      ) r ON true
      WHERE o.id=v_offering_id AND (r.id IS NOT NULL OR EXISTS(
        SELECT 1 FROM faculty_private.home_profiles h
        JOIN public.faculty_identity_links l ON l.identity_id=h.identity_id
        WHERE l.instructor_id=p_instructor_id AND h.home_college_id=v_dg.college_id
          AND public.can_manage_college(v_uid,v_dg.college_id)
      ))
      ON CONFLICT(assignment_id) DO UPDATE SET
        college_id=EXCLUDED.college_id,term_id=EXCLUDED.term_id,
        promotion_watermark=EXCLUDED.promotion_watermark,restored_at=now(),
        restored_by=EXCLUDED.restored_by,request_id=EXCLUDED.request_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_RESTORATION_APPROVAL_REQUIRED'; END IF;
    END IF;$restore$;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
COMMIT;
