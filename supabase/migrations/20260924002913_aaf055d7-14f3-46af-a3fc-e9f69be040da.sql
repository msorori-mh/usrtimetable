-- Orphan repair for a cross-college lecturer: bind the approved home-college request
-- (decided in this same transaction) to the new assignment before relinking draft sessions,
-- so ensure_ss_college can verify the approval. Function definition only; no data rewritten.
DO $migration$
DECLARE
  v_def text;
  v_marker text := E'    IF v_draft_before > 0 THEN\n      UPDATE public.schedule_sessions SET';
  v_insert text := E'    IF v_draft_before > 0 AND v_instructor.college_id IS DISTINCT FROM v_dg.college_id THEN\n'
    || E'      UPDATE public.faculty_teaching_requests fr SET assignment_id = v_row.id\n'
    || E'      WHERE fr.id = (\n'
    || E'        SELECT fr2.id FROM public.faculty_teaching_requests fr2\n'
    || E'        WHERE fr2.instructor_id = p_instructor_id AND fr2.college_id = v_dg.college_id\n'
    || E'          AND fr2.delivery_group_id = p_delivery_group_id AND fr2.status = ''approved''\n'
    || E'          AND fr2.assignment_id IS NULL AND fr2.decided_by = v_uid AND fr2.decided_at = now()\n'
    || E'        ORDER BY fr2.created_at DESC LIMIT 1);\n'
    || E'      IF NOT FOUND THEN\n'
    || E'        RAISE EXCEPTION ''ORPHAN_REPAIR_REQUEST_BINDING_FAILED'' USING ERRCODE = ''check_violation'';\n'
    || E'      END IF;\n'
    || E'    END IF;\n\n';
BEGIN
  v_def := pg_get_functiondef('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)'::regprocedure);
  IF position('ORPHAN_REPAIR_REQUEST_BINDING_FAILED' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
    RAISE EXCEPTION 'ORPHAN_REPAIR_PATCH_MARKER_NOT_UNIQUE';
  END IF;
  EXECUTE replace(v_def, v_marker, v_insert || v_marker);
END
$migration$;