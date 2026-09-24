-- Disposable empty PostgreSQL database only; contains no production data.
\set ON_ERROR_STOP on
\ir fixtures/atomic-compaction/setup.sql
\ir ../supabase/sql/partition_extended_day.sql
\ir ../supabase/sql/partition_extended_statement.sql
\ir ../supabase/sql/shared_lectures.sql
\ir ../supabase/sql/shared_lecture_runtime.sql
\ir fixtures/generation-resolver.sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS target_attendance_days_per_week integer,
  ADD COLUMN IF NOT EXISTS max_attendance_days_per_week integer;
\ir ../supabase/migrations/20260918020000_atomic_schedule_generation.sql

UPDATE plan_course_components SET weekly_contact_hours=10;
UPDATE teaching_assignments SET assigned_component_hours=10,weekly_hours=10;
CREATE FUNCTION test_support.addition(st time DEFAULT '08:00', d integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('teaching_assignment_id',test_support.id('one-assignment'),
   'day_of_week',d,'start_time',st,'end_time',st+interval '2 hours','room_id',test_support.id('one-room'))
$$;
CREATE FUNCTION test_support.generate(moves jsonb, additions jsonb, op text DEFAULT 'generation', cap integer DEFAULT 3)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
 SELECT public.apply_schedule_generation(test_support.id('one'),test_support.id('one-version'),test_support.id(op),
   eligibility_revision,updated_at,moves,additions,cap,'TEST_ONLY')
 FROM schedule_versions WHERE id=test_support.id('one-version')
$$;
GRANT USAGE ON SCHEMA test_support TO authenticated;
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN r:=test_support.generate(jsonb_build_array(test_support.move('one-a','10:00')),
 jsonb_build_array(test_support.addition()));PERFORM test_support.assert((r->>'ok')::boolean,r::text);END $$;
RESET ROLE;
SELECT test_support.assert((SELECT count(*)=3 FROM schedule_sessions WHERE college_id=test_support.id('one')),'missing create');
SELECT test_support.assert((SELECT start_time='10:00' FROM schedule_sessions WHERE id=test_support.id('one-a')),'missing relocation');
ROLLBACK;
SELECT 'PASS: atomic move and create with authenticated role' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
DO $$ DECLARE b jsonb:=test_support.state();r jsonb; BEGIN
 r:=test_support.generate(jsonb_build_array(test_support.move('one-a','10:00')),
   jsonb_build_array(test_support.addition(),test_support.addition()));
 PERFORM test_support.assert((r->>'ok')::boolean=false AND (r->>'applied')::int=0,r::text);
 PERFORM test_support.assert(test_support.state()=b,'failed second insert leaked move/first insert/audit/revision/receipt');
END $$;
ROLLBACK;
SELECT 'PASS: failed second insert rolls back the entire operation' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('reader')::text,true);
SELECT test_support.assert(test_support.generate('[]',jsonb_build_array(test_support.addition()))->>'code'='FORBIDDEN','reader accepted');
SELECT set_config('request.jwt.claim.sub',test_support.id('foreign-manager')::text,true);
SELECT test_support.assert(test_support.generate('[]',jsonb_build_array(test_support.addition()))->>'code'='FORBIDDEN','foreign manager accepted');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT test_support.assert(test_support.generate('[]',jsonb_build_array(test_support.addition()))->>'code'='FORBIDDEN','anonymous accepted');
ROLLBACK;
SELECT 'PASS: role and college boundaries' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
UPDATE schedule_sessions SET is_locked=true WHERE id=test_support.id('one-a');
DO $$ DECLARE b jsonb:=test_support.state();r jsonb; BEGIN
 r:=test_support.generate(jsonb_build_array(test_support.move('one-a','10:00')),jsonb_build_array(test_support.addition()));
 PERFORM test_support.assert(r->>'code'='SESSION_LOCKED',r::text);
 PERFORM test_support.assert(test_support.state()=b,'locked request leaked writes');
END $$;
ROLLBACK;
SELECT 'PASS: locked session is immutable' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
DO $$ DECLARE rev bigint;stamp timestamptz;r jsonb;b jsonb;m jsonb:=jsonb_build_array(test_support.move('one-a','10:00'));a jsonb:=jsonb_build_array(test_support.addition()); BEGIN
 SELECT eligibility_revision,updated_at INTO rev,stamp FROM schedule_versions WHERE id=test_support.id('one-version');
 r:=public.apply_schedule_generation(test_support.id('one'),test_support.id('one-version'),test_support.id('retry'),rev,stamp,m,a,3,'TEST_ONLY');
 PERFORM test_support.assert((r->>'ok')::boolean,r::text);
 b:=test_support.state();
 r:=public.apply_schedule_generation(test_support.id('one'),test_support.id('one-version'),test_support.id('retry'),rev,stamp,m,a,3,'TEST_ONLY');
 PERFORM test_support.assert((r->>'ok')::boolean AND test_support.state()=b,'retry reapplied writes');
 r:=public.apply_schedule_generation(test_support.id('one'),test_support.id('one-version'),test_support.id('stale'),rev,stamp,m,a,3,'TEST_ONLY');
 PERFORM test_support.assert(r->>'code'='STALE_SNAPSHOT',r::text);
 r:=public.apply_schedule_generation(test_support.id('one'),test_support.id('one-version'),test_support.id('retry'),rev,stamp,m,a,4,'TEST_ONLY');
 PERFORM test_support.assert(r->>'code'='OPERATION_ID_CONFLICT',r::text);
END $$;
ROLLBACK;
SELECT 'PASS: idempotency, stale revision and operation identity' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
UPDATE schedule_sessions SET day_of_week=1 WHERE id=test_support.id('one-b');
DO $$ DECLARE b jsonb:=test_support.state();r jsonb; BEGIN
 r:=test_support.generate('[]',jsonb_build_array(test_support.addition('08:00',2),test_support.addition('08:00',3),test_support.addition('08:00',4)),'cap',5);
 PERFORM test_support.assert(r->>'code'='INSTRUCTOR_ATTENDANCE_DAYS_EXCEEDED',r::text);
 PERFORM test_support.assert(test_support.state()=b,'day cap rejected after leaking sessions');
END $$;
UPDATE instructors SET max_attendance_days_per_week=5 WHERE id=test_support.id('one-teacher');
SELECT test_support.assert((test_support.generate('[]',jsonb_build_array(test_support.addition('08:00',2),
 test_support.addition('08:00',3),test_support.addition('08:00',4)),'cap-exception',5)->>'ok')::boolean,'explicit exception rejected');
ROLLBACK;
SELECT 'PASS: instructor cap enforced before commit and explicit exception preserved' AS test;

BEGIN;
SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);
DO $$ DECLARE b jsonb:=test_support.state();r jsonb; BEGIN
 r:=test_support.generate(jsonb_build_array(test_support.move('two-a','10:00')),jsonb_build_array(test_support.addition()));
 PERFORM test_support.assert(r->>'code'='SESSION_SCOPE_MISMATCH',r::text);
 r:=test_support.generate('[]',jsonb_build_array(test_support.addition()||jsonb_build_object('teaching_assignment_id',test_support.id('two-assignment'))));
 PERFORM test_support.assert(r->>'code'='ASSIGNMENT_SCOPE_MISMATCH',r::text);
 PERFORM test_support.assert(test_support.state()=b,'cross-tenant request changed state');
END $$;
ROLLBACK;
SELECT 'PASS: cross-tenant assignment and session IDs rejected' AS test;
