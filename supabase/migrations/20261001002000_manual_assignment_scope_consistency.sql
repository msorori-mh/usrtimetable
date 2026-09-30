BEGIN;
-- Fix manual assignment preview/write disagreement after draft-specific replacements.
-- Match the existing operational workspace policy. Draft-scoped rows are
-- separate alternatives, not additional co-teachers in the manual workspace.
-- Keep auth, home-college approval, true duplicates, quotas and version guards.
-- No assignment, request, session, schedule or permission is changed here.
DO $patch$
DECLARE p record; d text; occurrences integer;
BEGIN
 FOR p IN SELECT * FROM (VALUES
 ('public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)', $before0$AND ta.is_active = TRUE$before0$, $after0$AND ta.is_active = TRUE
    AND assignment_version_private.is_counted(ta.id)$after0$, 3),('public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)', $before1$ta2.is_active = TRUE$before1$, $after1$ta2.is_active = TRUE AND assignment_version_private.is_counted(ta2.id)$after1$, 2),('public.compute_delivery_group_allocation(uuid)', $before2$AND ta.is_active=true$before2$, $after2$AND ta.is_active=true AND assignment_version_private.is_counted(ta.id)$after2$, 2),('public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)', $before3$AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id);$before3$, $after3$AND assignment_version_private.is_counted(ta.id);$after3$, 1),('public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)', $before4$AND ta2.is_active = TRUE$before4$, $after4$AND ta2.is_active = TRUE
           AND assignment_version_private.is_counted(ta2.id)$after4$, 1),('faculty_private.submit_request(uuid,uuid,numeric,text,uuid,timestamp with time zone)', $before5$AND ta.is_active AND l.identity_id=h.identity_id$before5$, $after5$AND ta.is_active AND assignment_version_private.is_counted(ta.id) AND l.identity_id=h.identity_id$after5$, 1),('faculty_private.submit_request(uuid,uuid,numeric,text,uuid,timestamp with time zone)', $before6$AND ta.is_active AND i.id IS NULL$before6$, $after6$AND ta.is_active AND assignment_version_private.is_counted(ta.id) AND i.id IS NULL$after6$, 2),('faculty_private.submit_request(uuid,uuid,numeric,text,uuid,timestamp with time zone)', $before7$WHERE identity_id=h.identity_id AND delivery_group_id=g.id AND status='pending'$before7$, $after7$WHERE identity_id=h.identity_id AND delivery_group_id=g.id AND status='pending'
   AND NOT EXISTS (SELECT 1 FROM assignment_version_private.request_scope scoped
     WHERE scoped.request_id=faculty_teaching_requests.id)$after7$, 1),('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)', $before8$AND ta.instructor_id = p_instructor_id
  ORDER BY$before8$, $after8$AND ta.instructor_id = p_instructor_id
    AND (ta.scope_version_id IS NULL OR assignment_version_private.is_counted(ta.id))
  ORDER BY$after8$, 1),('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)', $before9$AND ta.is_active = true
$before9$, $after9$AND ta.is_active = true
    AND assignment_version_private.is_counted(ta.id)
$after9$, 2),('faculty_private.guard_assignment_request()', $before10$AND (NEW.scope_version_id IS NULL OR EXISTS ($before10$, $after10$AND ((NEW.scope_version_id IS NULL AND assignment_version_private.is_counted(a.id)) OR EXISTS ($after10$, 1),('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)', $before11$'allocation', public.compute_delivery_group_allocation(p_delivery_group_id)$before11$, $after11$'allocation', CASE WHEN public.can_view_college(v_uid, v_dg.college_id)
      THEN public.compute_delivery_group_allocation(p_delivery_group_id) ELSE NULL END$after11$, 1),('faculty_private.apply_update_assignment(uuid,timestamp with time zone,numeric,text)', $before12$'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)$before12$, $after12$'allocation', CASE WHEN public.can_view_college(v_uid, v_row.college_id)
      THEN public.compute_delivery_group_allocation(v_row.delivery_group_id) ELSE NULL END$after12$, 1)
 ) AS patches(signature, before_text, after_text, expected_count) LOOP
  d:=pg_get_functiondef(p.signature::regprocedure);
  occurrences:=(length(d)-length(replace(d,p.before_text,'')))/length(p.before_text);
  IF occurrences<>p.expected_count THEN
   RAISE EXCEPTION 'MANUAL_ASSIGNMENT_SCOPE_FUNCTION_DRIFT: %, expected %, found %',p.signature,p.expected_count,occurrences;
  END IF;
  EXECUTE replace(d,p.before_text,p.after_text);
 END LOOP;
END $patch$;
COMMIT;
