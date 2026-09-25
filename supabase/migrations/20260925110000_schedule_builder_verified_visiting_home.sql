-- A visiting lecturer may have a verified canonical home college that differs
-- from the older operational instructor row. Show only that lecturer's already
-- approved, exact teaching request in the draft builder.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_definition text;
  v_old text := 'fr.home_college_id = i.college_id';
  v_new text := $replacement$(fr.home_college_id = i.college_id
             OR EXISTS (
               SELECT 1
               FROM faculty_private.home_profiles hp
               WHERE hp.identity_id = fr.identity_id
                 AND hp.home_college_id = fr.home_college_id
                 AND hp.source_instructor_id = i.id
                 AND hp.is_active
                 AND hp.affiliation_status = 'verified'
             ))$replacement$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure
  );

  IF v_definition IS NULL
     OR strpos(v_definition, v_old) = 0
     OR strpos(substr(v_definition, strpos(v_definition, v_old) + length(v_old)), v_old) > 0
     OR strpos(v_definition, 'fr.status = ''approved''') = 0
     OR strpos(v_definition, 'fr.assignment_id = ta.id') = 0
     OR strpos(v_definition, 'fr.delivery_group_id = dg.id') = 0
     OR strpos(v_definition, 'fr.assigned_hours = COALESCE(ta.assigned_component_hours, ta.weekly_hours)') = 0
  THEN
    RAISE EXCEPTION 'SCHEDULE_BUILDER_VISITING_HOME_JOIN_DRIFT';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);

  IF strpos(pg_get_functiondef(
    'public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure
  ), 'hp.affiliation_status = ''verified''') = 0 THEN
    RAISE EXCEPTION 'SCHEDULE_BUILDER_VERIFIED_HOME_GATE_MISSING';
  END IF;
END;
$migration$;

COMMENT ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)
  IS 'Draft work items: local staff and exact approved visiting requests, including verified canonical home where the legacy operational instructor college differs.';

NOTIFY pgrst, 'reload schema';
COMMIT;
