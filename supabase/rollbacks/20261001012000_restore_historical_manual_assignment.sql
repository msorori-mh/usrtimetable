BEGIN;
DO $patch$
DECLARE d text; old_text text; new_text text;
BEGIN
 IF EXISTS(SELECT 1 FROM assignment_version_private.manual_restorations) THEN
   RAISE EXCEPTION 'MANUAL_RESTORATION_IN_USE_REQUIRES_EXPLICIT_DATA_ROLLBACK';
 END IF;
 d:=pg_get_functiondef('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)'::regprocedure);
 old_text:=$restore$ELSIF v_existing.id IS NOT NULL THEN
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
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'MANUAL_RESTORATION_ROLLBACK_DRIFT'; END IF;
 d:=replace(d,old_text,'ELSIF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN');
 d:=replace(d,'IF v_existing.id IS NOT NULL AND v_existing.is_active AND assignment_version_private.is_counted(v_existing.id) THEN','IF v_existing.id IS NOT NULL AND v_existing.is_active THEN');
 EXECUTE d;
 d:=pg_get_functiondef('assignment_version_private.is_counted(uuid)'::regprocedure);
 old_text:='SELECT CASE WHEN assignment_version_private.manual_restoration_counts(a) THEN true';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'MANUAL_RESTORATION_ROLLBACK_POLICY_DRIFT'; END IF;
 EXECUTE replace(d,old_text,'SELECT CASE');
END $patch$;
DROP FUNCTION assignment_version_private.manual_restoration_counts(uuid);
DROP FUNCTION assignment_version_private.promotion_watermark(uuid,uuid);
DROP TABLE assignment_version_private.manual_restorations;
COMMIT;
