-- Show approved visiting assignments and exact Education home assignments.
-- Legacy instructor rows can have an operational college different from their
-- canonical home. Do not move those rows or weaken the session guard.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.education_canonical_home_assignment(
  p_assignment_id uuid, p_instructor_id uuid, p_college_id uuid,
  p_delivery_group_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $helper$
  SELECT p_college_id = '1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.teaching_assignments ta
      JOIN public.faculty_identity_links fl
        ON fl.instructor_id = ta.instructor_id
      JOIN faculty_private.home_profiles hp
        ON hp.identity_id = fl.identity_id
      WHERE ta.id = p_assignment_id
        AND ta.is_active
        AND ta.instructor_id = p_instructor_id
        AND ta.college_id = p_college_id
        AND ta.delivery_group_id = p_delivery_group_id
        AND hp.home_college_id = p_college_id
        AND hp.source_instructor_id = p_instructor_id
        AND hp.is_active
        AND hp.affiliation_status IN ('verified', 'declared')
    );
$helper$;

REVOKE ALL ON FUNCTION public.education_canonical_home_assignment(uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_canonical_home_assignment(uuid,uuid,uuid,uuid) TO authenticated, service_role;

DO $migration$
DECLARE
  v_definition text;
  v_old text := 'AND i.college_id = ta.college_id';
  v_new text := $replacement$AND (
       i.college_id = ta.college_id
       OR public.education_canonical_home_assignment(ta.id, i.id, ta.college_id, dg.id)
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

DO $trigger_migration$
DECLARE
  v_definition text;
  v_old text := 'IF ic <> NEW.college_id AND NOT v_existing_instructor_link_unchanged AND NOT EXISTS (';
  v_new text := 'IF ic <> NEW.college_id AND NOT v_existing_instructor_link_unchanged AND NOT public.education_canonical_home_assignment(NEW.teaching_assignment_id, NEW.instructor_id, NEW.college_id, NEW.delivery_group_id) AND NOT EXISTS (';
BEGIN
  v_definition := pg_get_functiondef('public.ensure_ss_college()'::regprocedure);
  IF v_definition IS NULL
     OR strpos(v_definition, v_old) = 0
     OR strpos(substr(v_definition, strpos(v_definition, v_old) + length(v_old)), v_old) > 0
  THEN
    RAISE EXCEPTION 'SCHEDULE_SESSION_INSTRUCTOR_GUARD_DRIFT';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
  IF strpos(pg_get_functiondef('public.ensure_ss_college()'::regprocedure),
            'public.education_canonical_home_assignment(NEW.teaching_assignment_id') = 0 THEN
    RAISE EXCEPTION 'SCHEDULE_SESSION_CANONICAL_HOME_GATE_MISSING';
  END IF;
END;
$trigger_migration$;

COMMENT ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)
  IS 'Draft schedule work items: operational local instructors, Education canonical home instructors, and exactly approved visiting instructors.';

COMMENT ON FUNCTION public.education_canonical_home_assignment(uuid,uuid,uuid,uuid)
  IS 'Education only: active assignment with matching instructor/group and active canonical home identity, including unanimously declared home.';

NOTIFY pgrst, 'reload schema';
COMMIT;
