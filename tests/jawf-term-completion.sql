-- Run after 20260929003000; all test mutations roll back.
BEGIN;
DO $$ DECLARE c jsonb; BEGIN
 c:=public.jawf_term_completion_coverage('286e37d4-d45c-5942-b8e0-facdfed3081f');
 IF NOT (c->>'complete')::boolean OR (c->>'total_groups')::int<>66
    OR (c->>'scheduled_hours')::numeric<>153 OR (c->>'missing_hours')::numeric<>0
 THEN RAISE EXCEPTION 'JAWF_COVERAGE_REGRESSION: %',c; END IF;
 IF public.jawf_term_completion_verified('9ef411ff-0e91-e754-2985-44799be1255e') THEN
  RAISE EXCEPTION 'JAWF_EXCEPTION_SCOPE_LEAK'; END IF;
 IF (SELECT count(*) FROM jawf_term_source_private.completion_before WHERE kind='source')<>67
 THEN RAISE EXCEPTION 'JAWF_SOURCE_BACKUP_INCOMPLETE'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments t JOIN public.instructors i ON i.id=t.instructor_id
 WHERE i.external_source LIKE 'JWF26F-NAME:%') THEN RAISE EXCEPTION 'JAWF_PROVISIONAL_HR_LEAK'; END IF;
 IF EXISTS(SELECT 1 FROM public.existing_schedule_source_rows r
 JOIN jawf_term_source_private.completion_before b ON b.kind='source' AND b.id=r.id
 WHERE r.raw_time IS DISTINCT FROM b.original->>'raw_time'
 OR r.raw_day IS DISTINCT FROM b.original->>'raw_day'
 OR r.raw_teacher IS DISTINCT FROM b.original->>'raw_teacher') THEN RAISE EXCEPTION 'JAWF_RAW_SOURCE_CHANGED'; END IF;
END; $$;
UPDATE jawf_term_source_private.sessions SET expected=jsonb_set(expected,'{expected_students}','999')
WHERE source_row_id=(SELECT id FROM public.existing_schedule_source_rows WHERE source_id='JWF-SCI-2026-S1-L1-R17');
DO $$ BEGIN
 IF public.jawf_term_completion_verified('286e37d4-d45c-5942-b8e0-facdfed3081f') THEN
  RAISE EXCEPTION 'JAWF_MANIFEST_TAMPER_NOT_REJECTED'; END IF;
END; $$;
ROLLBACK;
