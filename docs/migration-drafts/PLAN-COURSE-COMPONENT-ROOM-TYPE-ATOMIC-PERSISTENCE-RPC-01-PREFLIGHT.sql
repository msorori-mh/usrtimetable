-- READ-ONLY PREFLIGHT. No writes.
SELECT
  to_regprocedure('public.commit_import_job_atomic(uuid,timestamp with time zone)') IS NOT NULL
    AS historical_entrypoint_present,
  to_regprocedure('public.import_manager_actor(uuid)') IS NOT NULL AS auth_helper_present,
  to_regprocedure('public._import_apply_study_plan(uuid,text,jsonb)') IS NOT NULL
    AS historical_plan_helper_present,
  to_regprocedure('public._import_sync_plan_course_components(uuid,uuid,jsonb)') IS NOT NULL
    AS historical_component_helper_present;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.plan_course_components'::regclass
  AND contype IN ('u', 'p', 'f')
ORDER BY conname;

SELECT p.oid::regprocedure AS function_signature,
       p.prosecdef AS security_definer,
       r.rolname AS owner,
       p.proconfig AS settings,
       p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'commit_import_job_atomic',
    'import_manager_actor',
    '_import_apply_study_plan',
    '_import_sync_plan_course_components'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

SELECT count(*) AS active_plan_schedulable_components_missing_room_type
FROM public.plan_course_components pcc
JOIN public.plan_courses pc ON pc.id = pcc.plan_course_id
JOIN public.study_plans sp ON sp.id = pc.study_plan_id
WHERE sp.is_active
  AND pcc.is_timetabled
  AND pcc.weekly_contact_hours > 0
  AND pcc.component_type <> 'summer_training'
  AND pcc.required_room_type_id IS NULL;
