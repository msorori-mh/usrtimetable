-- READ-ONLY POST VERIFIER. No writes.
SELECT p.oid::regprocedure AS signature,
       p.prosecdef AS security_definer,
       r.rolname AS owner,
       p.proconfig AS settings,
       p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'commit_plan_component_import_job_atomic_v2',
    'commit_import_job_atomic',
    'commit_import_job_atomic_legacy_impl',
    '_import_validate_plan_component_payload_v2',
    '_import_sync_plan_components_atomic_v2'
  )
ORDER BY p.proname;

WITH defects AS (
  SELECT pcc.id,
    CASE
      WHEN pcc.required_room_type_id IS NULL THEN 'NULL_REQUIRED_ROOM_TYPE'
      WHEN rt.id IS NULL THEN 'ORPHAN_ROOM_TYPE'
      WHEN rt.college_id IS DISTINCT FROM pcc.college_id THEN 'WRONG_COLLEGE_ROOM_TYPE'
      WHEN NOT rt.is_active THEN 'INACTIVE_ROOM_TYPE'
      WHEN rt.default_capacity <= 0 THEN 'ZERO_CAPACITY_ROOM_TYPE'
    END AS issue
  FROM public.plan_course_components pcc
  JOIN public.plan_courses pc ON pc.id = pcc.plan_course_id
  JOIN public.study_plans sp ON sp.id = pc.study_plan_id
  LEFT JOIN public.room_types rt ON rt.id = pcc.required_room_type_id
  WHERE sp.is_active
    AND pcc.is_timetabled
    AND pcc.weekly_contact_hours > 0
    AND pcc.component_type <> 'summer_training'
)
SELECT issue, count(*) FROM defects WHERE issue IS NOT NULL GROUP BY issue ORDER BY issue;

SELECT count(*) AS atomic_audits_with_count_mismatch
FROM public.audit_logs
WHERE action = 'import_plan_components_atomic_v2'
  AND (details->'result'->>'expected_required_room_components')::integer
      IS DISTINCT FROM
      (details->'result'->>'persisted_components_with_required_room_type_id')::integer;
