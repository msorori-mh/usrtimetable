-- M-13 server side: commit_import_job_atomic must re-validate business rules
-- (time order, day range, numeric format/range) instead of trusting the
-- browser-validated payload. Self-contained; rolls back.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000a013', 'm13@test.local');
INSERT INTO public.universities (id, name) VALUES ('00000000-0000-0000-0000-00000000b013', 'M13 Uni');
INSERT INTO public.colleges (id, university_id, name)
VALUES ('00000000-0000-0000-0000-00000000c013', '00000000-0000-0000-0000-00000000b013', 'M13 College');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-00000000a013', 'super_admin')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE m13_cases (label text, entity text, payload jsonb, expect_ok boolean, expect_code text);
INSERT INTO m13_cases VALUES
  ('valid break 8:00-10:00 (1-digit hour)', 'daily_breaks',
   '[{"rowNumber":2,"values":{"name":"استراحة","start_time":"8:00","end_time":"10:00","days":[0,1,2]}}]', true, NULL),
  ('break end before start (lexically later)', 'daily_breaks',
   '[{"rowNumber":2,"values":{"name":"x","start_time":"10:00","end_time":"9:00","days":[0]}}]', false, 'IMPORT_INVALID_TIME_RANGE'),
  ('break equal start/end', 'daily_breaks',
   '[{"rowNumber":3,"values":{"name":"x","start_time":"10:00","end_time":"10:00","days":[0]}}]', false, 'IMPORT_INVALID_TIME_RANGE'),
  ('break day 7', 'daily_breaks',
   '[{"rowNumber":4,"values":{"name":"x","start_time":"08:00","end_time":"09:00","days":[0,7]}}]', false, 'IMPORT_INVALID_DAYS'),
  ('break day as text garbage', 'daily_breaks',
   '[{"rowNumber":4,"values":{"name":"x","start_time":"08:00","end_time":"09:00","days":"0,x"}}]', false, 'IMPORT_INVALID_DAYS'),
  ('break malformed time', 'daily_breaks',
   '[{"rowNumber":5,"values":{"name":"x","start_time":"25:00","end_time":"26:00","days":[1]}}]', false, 'IMPORT_INVALID_TIME'),
  ('room negative capacity', 'rooms',
   '[{"rowNumber":2,"values":{"code":"R1","name":"R1","room_type":"lecture_hall","capacity":-5}}]', false, 'IMPORT_NUMBER_OUT_OF_RANGE'),
  ('room exponent capacity string', 'rooms',
   '[{"rowNumber":2,"values":{"code":"R1","name":"R1","room_type":"lecture_hall","capacity":"1e3"}}]', false, 'IMPORT_INVALID_NUMBER'),
  ('room availability reversed', 'rooms',
   '[{"rowNumber":2,"values":{"code":"R1","name":"R1","room_type":"lecture_hall","capacity":30,"available_start_time":"14:00","available_end_time":"8:00"}}]', false, 'IMPORT_INVALID_TIME_RANGE'),
  ('instructor weekly hours > 168', 'instructors',
   '[{"rowNumber":2,"values":{"full_name":"م","employee_number":"E1","max_weekly_hours":500}}]', false, 'IMPORT_NUMBER_OUT_OF_RANGE'),
  ('plan lectures without duration', 'study_plan_courses',
   '[{"rowNumber":2,"values":{"course_code":"C1","level_number":1,"semester":1,"lectures_per_week":2,"lecture_session_duration":0}}]', false, 'IMPORT_INVALID_PATTERN'),
  ('plan fractional semester', 'study_plan_courses',
   '[{"rowNumber":2,"values":{"course_code":"C1","level_number":1,"semester":1.5}}]', false, 'IMPORT_INVALID_NUMBER');

DO $$
DECLARE
  c record;
  v_job uuid;
  v_result jsonb;
  v_ok boolean;
  v_msg text;
  v_breaks int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a013', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000a013","role":"authenticated","aal":"aal2"}', true);
  FOR c IN SELECT * FROM m13_cases LOOP
    INSERT INTO public.import_jobs (college_id, target_entity, mode, status, created_by,
                                   validated_payload, payload_manifest, total_rows, valid_rows)
    VALUES ('00000000-0000-0000-0000-00000000c013', c.entity, 'insert_only', 'preview',
            '00000000-0000-0000-0000-00000000a013', c.payload, md5(c.payload::text), 1, 1)
    RETURNING id INTO v_job;
    v_ok := true;
    v_msg := NULL;
    BEGIN
      v_result := public.commit_import_job_atomic(v_job, NULL);
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      v_msg := SQLERRM;
    END;
    IF v_ok IS DISTINCT FROM c.expect_ok THEN
      RAISE EXCEPTION 'M-13 case "%": expected ok=% got ok=% (%)', c.label, c.expect_ok, v_ok, v_msg;
    END IF;
    IF NOT c.expect_ok AND position(c.expect_code IN v_msg) = 0 THEN
      RAISE EXCEPTION 'M-13 case "%": expected % got "%"', c.label, c.expect_code, v_msg;
    END IF;
    IF NOT c.expect_ok AND (SELECT status FROM public.import_jobs WHERE id = v_job) <> 'preview' THEN
      RAISE EXCEPTION 'M-13 case "%": rejected job must stay in preview', c.label;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_breaks FROM public.daily_breaks
  WHERE college_id = '00000000-0000-0000-0000-00000000c013';
  IF v_breaks <> 1 THEN
    RAISE EXCEPTION 'M-13: exactly the one valid break must be written, got %', v_breaks;
  END IF;
  IF (SELECT start_time FROM public.daily_breaks WHERE college_id = '00000000-0000-0000-0000-00000000c013')
     <> time '08:00' THEN
    RAISE EXCEPTION 'M-13: valid break stored with wrong start time';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rooms WHERE college_id = '00000000-0000-0000-0000-00000000c013') THEN
    RAISE EXCEPTION 'M-13: rejected rooms must not be written';
  END IF;
END $$;

-- Helpers are not callable by app roles.
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public._import_validate_rows(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._import_dispatch(uuid,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._import_dispatch(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M-13: internal import helpers must not be executable by anon/authenticated';
  END IF;
END $$;

SELECT 'import-commit-server-revalidation: PASS';
ROLLBACK;
