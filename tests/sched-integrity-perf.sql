-- Track C performance check (Q-2 / H-6): server validation of a ~600-session version and a
-- generation-sized bulk insert (one transaction, service role, re-checked at commit).
-- Disposable replayed database; rolled back.
\set ON_ERROR_STOP on
\set n_sessions 600
\set fast_fixture 1
BEGIN;
\ir fixtures/sched-integrity.sql
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE t0 timestamptz := clock_timestamp(); r jsonb; ms numeric;
BEGIN
  r := public.validate_schedule_version(tsched.id('ver-a'));
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  RAISE NOTICE 'validate_schedule_version: % sessions in % ms, hard=%', r->>'session_count', round(ms), r->>'hard_count';
  PERFORM tsched.assert((r->>'session_count')::int >= 600, 'fixture size');
  PERFORM tsched.assert((r->>'hard_count')::int = 0, 'fixture is conflict-free: ' || (r->'hard_conflicts')::text);
  PERFORM tsched.assert(ms < 5000, 'validation too slow: ' || ms || ' ms');
END $t$;
RESET ROLE;

-- Generation-like bulk insert into a second draft: 150 rows in one transaction, measured once
-- as the function owner (server-function path, guard skipped) and once as service_role
-- (re-checked at commit). Most of the cost is the pre-existing per-row coordination check
-- (schedule_coordination_private.check_version); the new guard must not add materially to it.
INSERT INTO public.schedule_versions(id, college_id, academic_term_id, name, status)
VALUES (tsched.id('ver-gen'), tsched.id('A'), tsched.id('term-a'), 'توليد', 'draft');
GRANT EXECUTE ON FUNCTION tsched.id(text) TO PUBLIC;
CREATE TEMP TABLE perf(role text, ms numeric);
GRANT ALL ON perf TO service_role;
CREATE OR REPLACE FUNCTION pg_temp.bulk(p_role text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.schedule_sessions(college_id, schedule_version_id, course_offering_id, instructor_id,
    room_id, study_system, day_of_week, start_time, end_time, session_type, expected_students, source_type)
  SELECT tsched.id('A'), tsched.id('ver-gen'), tsched.id('off-'||(i % 30)), tsched.id('ins-'||(i % 40)),
    tsched.id('room-'||(i % 40)), 'regular', (i / 120) % 5, time '08:00' + ((i / 40) % 3) * interval '2 hours',
    time '10:00' + ((i / 40) % 3) * interval '2 hours', 'lecture', 30, 'auto_generated'
  FROM generate_series(0, 149) i;
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO perf VALUES (p_role, extract(epoch FROM clock_timestamp() - t0) * 1000);
END $f$;
SAVEPOINT owner_run;
SELECT pg_temp.bulk('owner');
CREATE TEMP TABLE perf_keep AS SELECT * FROM perf;
ROLLBACK TO SAVEPOINT owner_run;
SET CONSTRAINTS ALL DEFERRED;
GRANT ALL ON perf TO service_role;
SET ROLE service_role;
SELECT pg_temp.bulk('service_role');
RESET ROLE;
DO $t$
DECLARE o numeric; s numeric;
BEGIN
  SELECT ms INTO o FROM perf_keep WHERE role = 'owner';
  SELECT ms INTO s FROM perf WHERE role = 'service_role';
  RAISE NOTICE 'bulk insert 150 rows: owner path % ms, service_role path (guarded) % ms', round(o), round(s);
  PERFORM tsched.assert(s <= o * 1.5 + 3000, 'guard overhead too high');
END $t$;
ROLLBACK;
SELECT 'PASS: sched-integrity-perf' AS result;
