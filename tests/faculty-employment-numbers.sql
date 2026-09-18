BEGIN;
-- Run after the migration against the disposable TEST_ONLY college. Always rolls back.

DO $test$
DECLARE v_id uuid; v_identity uuid; v_before text; v_after text; v_type uuid; v_college uuid:='d534bf5a-8bbb-4b84-b1b7-e887c8433683'; v_case record;
BEGIN
 FOR v_case IN SELECT * FROM (VALUES('permanent','P'),('annual_contract','C'),('con','H')) t(code,prefix) LOOP
  SELECT id INTO STRICT v_type FROM public.instructor_types WHERE college_id=v_college AND code=v_case.code;
  INSERT INTO public.instructors(college_id,full_name,employment_type,instructor_type_id,affiliation_college_id,max_weekly_hours)
   VALUES(v_college,'TEST_ONLY employment number rollback '||v_case.code,'unknown',v_type,v_college,18) RETURNING id INTO v_id;
  SELECT l.identity_id,f.university_number INTO STRICT v_identity,v_before FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id WHERE l.instructor_id=v_id;
  IF v_before !~ ('^USABA-'||v_case.prefix||'-[0-9]{6,}$') THEN RAISE EXCEPTION 'Bad code: %',v_before; END IF;
  IF v_case.code='con' THEN
   UPDATE public.instructors SET instructor_type_id=(SELECT id FROM public.instructor_types WHERE college_id=v_college AND code='permanent') WHERE id=v_id;
   SELECT university_number INTO v_after FROM public.faculty_identities WHERE id=v_identity;
   IF v_after !~ '^USABA-P-[0-9]{6,}$' OR v_after=v_before THEN RAISE EXCEPTION 'Promotion failed'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.faculty_number_history WHERE university_number=v_before AND identity_id=v_identity)
    OR NOT EXISTS(SELECT 1 FROM public.faculty_identity_links WHERE instructor_id=v_id AND identity_id=v_identity) THEN RAISE EXCEPTION 'Identity/history lost'; END IF;
  END IF;
 END LOOP;
 IF has_table_privilege('authenticated','public.faculty_number_history','SELECT')
    OR has_function_privilege('authenticated','public.update_faculty_employment_number()','EXECUTE') THEN RAISE EXCEPTION 'Unexpected direct access'; END IF;
END $test$;

ROLLBACK;

