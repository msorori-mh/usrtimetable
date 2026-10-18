-- M-10 (track C): session writes take instructor-identity advisory locks, not a university-wide
-- write gate. Disposable replayed database; rolled back. (No dblink here: the test inspects
-- pg_locks of this backend instead of running two concurrent sessions.)
\set ON_ERROR_STOP on
\ir fixtures/sched-integrity-cleanup.sql
BEGIN;
\ir fixtures/sched-integrity.sql
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
-- Fresh transaction with no locks yet.
BEGIN;
SELECT tsched.assert(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'coordination_serialize_%'),
  'global write-gate triggers removed');
CREATE TEMP TABLE gate_before AS SELECT revision FROM schedule_coordination_private.write_gate;
UPDATE public.schedule_sessions SET room_id = tsched.id('room-39') WHERE id = tsched.id('s-0');
DO $t$
DECLARE k bigint := schedule_coordination_private.identity_lock_key(tsched.id('ins-0'));
  k2 bigint := schedule_coordination_private.identity_lock_key(tsched.id('ins-1'));
BEGIN
  PERFORM tsched.assert((SELECT revision FROM schedule_coordination_private.write_gate)
    = (SELECT revision FROM gate_before), 'write_gate row was updated (global serialisation)');
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
    AND classid = 0 AND objid::bigint = k AND objsubid = 1 AND granted), 'identity lock of ins-0 held');
  PERFORM tsched.assert(NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
    AND classid = 0 AND objid::bigint = k2 AND k2 <> k), 'unrelated instructor not locked');
END $t$;
ROLLBACK;

-- Linked identities share one key (aliases of one faculty member serialise together).
BEGIN;
UPDATE public.faculty_identity_links SET identity_id =
  (SELECT identity_id FROM public.faculty_identity_links WHERE instructor_id = tsched.id('ins-0'))
WHERE instructor_id = tsched.id('ins-1');
SELECT tsched.assert(schedule_coordination_private.identity_lock_key(tsched.id('ins-0'))
  = schedule_coordination_private.identity_lock_key(tsched.id('ins-1')), 'aliases share a lock key');
-- A version status change locks every identity of its sessions.
UPDATE public.schedule_versions SET is_coordination = true WHERE id = tsched.id('ver-a');
SELECT tsched.assert((SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
  AND classid = 0 AND objid::bigint BETWEEN 73110000 AND 73114095) >= 30, 'version identities locked');
ROLLBACK;

\ir fixtures/sched-integrity-cleanup.sql
SELECT 'PASS: sched-coordination-locks-db (M-10)' AS result;
