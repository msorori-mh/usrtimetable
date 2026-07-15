-- READ-ONLY postchecks (not a migration).

SELECT action, details ->> 'result' AS result, details
FROM public.audit_logs
WHERE action IN (
  'COURSE_OFFERING_TERM_HARDENING',
  'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT',
  'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT_CLEANUP'
)
ORDER BY created_at DESC
LIMIT 10;

SELECT conname, convalidated, confdeltype
FROM pg_constraint
WHERE conname = 'course_offerings_term_id_fkey';

SELECT 'uat_offerings' AS t, COUNT(*) FROM public.course_offerings WHERE id = '6a015203-0001-4000-8000-000000000001'
UNION ALL SELECT 'uat_versions', COUNT(*) FROM public.schedule_versions WHERE id = '6a015203-0001-4000-8000-000000000005'
UNION ALL SELECT 'uat_sessions', COUNT(*) FROM public.schedule_sessions WHERE id = '6a015203-0001-4000-8000-000000000006'
UNION ALL SELECT 'uat_sections', COUNT(*) FROM public.sections WHERE id = '6a015203-0001-4000-8000-000000000003'
UNION ALL SELECT 'uat_tas', COUNT(*) FROM public.teaching_assignments WHERE id = '6a015203-0001-4000-8000-000000000002';
