-- READ-ONLY postchecks for create/cleanup (not a migration).

-- After CREATE
SELECT action, details ->> 'result' AS result, details -> 'ids' AS ids, details -> 'enrollment_uat' AS enrollment_uat
FROM public.audit_logs
WHERE action = 'SCHEDULE_BUILDER_PHASE6_UAT'
ORDER BY created_at DESC
LIMIT 3;

-- After CLEANUP
SELECT action, details ->> 'result' AS result, details -> 'deleted_counts' AS deleted_counts, details -> 'enrollment_restored' AS enrollment_restored
FROM public.audit_logs
WHERE action = 'SCHEDULE_BUILDER_PHASE6_UAT_CLEANUP'
ORDER BY created_at DESC
LIMIT 3;

-- Residual UAT rows (expect 0 after cleanup)
SELECT 'schedule_versions' AS t, COUNT(*) FROM public.schedule_versions WHERE id = '6a015200-0001-4000-8000-000000000003'
UNION ALL SELECT 'schedule_sessions', COUNT(*) FROM public.schedule_sessions WHERE id = '6a015200-0001-4000-8000-000000000004'
UNION ALL SELECT 'sections', COUNT(*) FROM public.sections WHERE id = '6a015200-0001-4000-8000-000000000001'
UNION ALL SELECT 'course_offering_sections', COUNT(*) FROM public.course_offering_sections WHERE id = '6a015200-0001-4000-8000-000000000002'
UNION ALL SELECT 'section_subgroups', COUNT(*) FROM public.section_subgroups WHERE section_id = '6a015200-0001-4000-8000-000000000001';
