-- Include only formally approved cross-college assignments in the builder's
-- read model. Teaching assignments, instructor home colleges, and sessions
-- are not changed by this migration.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_definition text;
  v_old text := 'AND i.college_id = ta.college_id';
  v_new text := $replacement$AND (
       i.college_id = ta.college_id
       OR EXISTS (
         SELECT 1
         FROM public.faculty_teaching_requests fr
         JOIN public.faculty_identity_links fl
           ON fl.identity_id = fr.identity_id
          AND fl.instructor_id = i.id
         WHERE fr.assignment_id = ta.id
           AND fr.instructor_id = i.id
           AND fr.home_college_id = i.college_id
           AND fr.college_id = ta.college_id
           AND fr.delivery_group_id = dg.id
           AND fr.term_id = ac.term_id
           AND fr.status = 'approved'
           AND fr.decided_by IS NOT NULL
           AND fr.decided_at IS NOT NULL
           AND fr.assigned_hours = COALESCE(ta.assigned_component_hours, ta.weekly_hours)
       )
     )$replacement$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure
  );

  IF v_definition IS NULL
     OR strpos(v_definition, v_old) = 0
     OR strpos(substr(v_definition, strpos(v_definition, v_old) + length(v_old)), v_old) > 0
  THEN
    RAISE EXCEPTION 'SCHEDULE_BUILDER_WORK_ITEM_JOIN_DRIFT';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);

  IF strpos(pg_get_functiondef(
    'public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure
  ), 'fr.status = ''approved''') = 0 THEN
    RAISE EXCEPTION 'SCHEDULE_BUILDER_APPROVAL_GATE_MISSING';
  END IF;
END;
$migration$;

COMMENT ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)
  IS 'Draft schedule work items: local instructors and exactly approved cross-college assignments, with assignment, group, term, home college, identity and hours verified.';

NOTIFY pgrst, 'reload schema';
COMMIT;
