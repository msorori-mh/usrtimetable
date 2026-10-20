-- M-10 (track C): replace the university-wide write gate with instructor-identity locks.
--
-- schedule_coordination_private.serialize_write() updated ONE row of write_gate on every
-- statement touching schedule_sessions, schedule_versions or academic_terms, so every
-- timetable write in the university waited for every other one.
--
-- Purpose preserved: the deferred schedule_coordination_private.check_version() compares a
-- version's sessions with other colleges' published/coordination sessions of the same
-- faculty identity. Two transactions can only invalidate each other's check when they place
-- (or publish/coordinate) sessions of the same identity. Each writer now takes transaction
-- advisory locks on the identity buckets it touches (faculty_identity_links.identity_id, or
-- the instructor itself when unlinked, plus instructors listed on existing source rows),
-- acquired in sorted order to avoid deadlocks. Keying by academic term would NOT be enough:
-- check_version matches other colleges' terms by date overlap, and every college has its own
-- term rows. Buckets (hash mod 4096) bound the number of locks per transaction.
BEGIN;

CREATE OR REPLACE FUNCTION schedule_coordination_private.identity_lock_key(p_instructor uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp AS $fn$
  SELECT (abs(hashtextextended(COALESCE(
    (SELECT l.identity_id::text FROM public.faculty_identity_links l WHERE l.instructor_id = p_instructor ORDER BY l.identity_id LIMIT 1),
    p_instructor::text), 7311)) % 4096) + 73110000
$fn$;

CREATE OR REPLACE FUNCTION schedule_coordination_private.lock_identity_keys(p_keys bigint[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_temp AS $fn$
DECLARE k bigint;
BEGIN
  FOR k IN SELECT DISTINCT x FROM unnest(p_keys) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(k);
  END LOOP;
END $fn$;

CREATE OR REPLACE FUNCTION schedule_coordination_private.lock_session_identities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_temp AS $fn$
BEGIN
  PERFORM schedule_coordination_private.lock_identity_keys(ARRAY(
    SELECT schedule_coordination_private.identity_lock_key(x.instructor_id)
    FROM (SELECT n.instructor_id FROM new_rows n
          UNION SELECT unnest(src.instructor_ids) FROM public.existing_schedule_source_rows src
                JOIN new_rows n ON src.schedule_session_id = n.id) x));
  RETURN NULL;
END $fn$;

-- A version whose status / coordination flag / term changes affects all its identities.
-- (Routine updates such as the eligibility_revision bump on every session write do not.)
CREATE OR REPLACE FUNCTION schedule_coordination_private.lock_version_identities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM schedule_coordination_private.lock_identity_keys(ARRAY(
      SELECT schedule_coordination_private.identity_lock_key(s.instructor_id)
      FROM public.schedule_sessions s JOIN new_rows n ON n.id = s.schedule_version_id));
  ELSE
    PERFORM schedule_coordination_private.lock_identity_keys(ARRAY(
      SELECT schedule_coordination_private.identity_lock_key(s.instructor_id)
      FROM public.schedule_sessions s
      JOIN new_rows n ON n.id = s.schedule_version_id
      JOIN old_rows o ON o.id = n.id
      WHERE (o.status, o.is_coordination, o.academic_term_id, o.college_id)
        IS DISTINCT FROM (n.status, n.is_coordination, n.academic_term_id, n.college_id)));
  END IF;
  RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION schedule_coordination_private.lock_term_identities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_temp AS $fn$
BEGIN
  PERFORM schedule_coordination_private.lock_identity_keys(ARRAY(
    SELECT schedule_coordination_private.identity_lock_key(s.instructor_id)
    FROM public.schedule_sessions s
    JOIN public.schedule_versions v ON v.id = s.schedule_version_id
    JOIN new_rows n ON n.id = v.academic_term_id
    JOIN old_rows o ON o.id = n.id
    WHERE (o.start_date, o.end_date) IS DISTINCT FROM (n.start_date, n.end_date)));
  RETURN NULL;
END $fn$;

REVOKE ALL ON FUNCTION schedule_coordination_private.identity_lock_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION schedule_coordination_private.lock_identity_keys(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION schedule_coordination_private.lock_session_identities() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION schedule_coordination_private.lock_version_identities() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION schedule_coordination_private.lock_term_identities() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coordination_serialize_sessions ON public.schedule_sessions;
DROP TRIGGER IF EXISTS coordination_serialize_versions ON public.schedule_versions;
DROP TRIGGER IF EXISTS coordination_serialize_terms ON public.academic_terms;

-- Deletes cannot create a cross-college overlap, so only INSERT and UPDATE lock.
DROP TRIGGER IF EXISTS coordination_lock_sessions_insert ON public.schedule_sessions;
CREATE TRIGGER coordination_lock_sessions_insert AFTER INSERT ON public.schedule_sessions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION schedule_coordination_private.lock_session_identities();
DROP TRIGGER IF EXISTS coordination_lock_sessions_update ON public.schedule_sessions;
CREATE TRIGGER coordination_lock_sessions_update AFTER UPDATE ON public.schedule_sessions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION schedule_coordination_private.lock_session_identities();
DROP TRIGGER IF EXISTS coordination_lock_versions_insert ON public.schedule_versions;
CREATE TRIGGER coordination_lock_versions_insert AFTER INSERT ON public.schedule_versions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION schedule_coordination_private.lock_version_identities();
DROP TRIGGER IF EXISTS coordination_lock_versions_update ON public.schedule_versions;
CREATE TRIGGER coordination_lock_versions_update AFTER UPDATE ON public.schedule_versions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION schedule_coordination_private.lock_version_identities();
DROP TRIGGER IF EXISTS coordination_lock_terms_update ON public.academic_terms;
CREATE TRIGGER coordination_lock_terms_update AFTER UPDATE ON public.academic_terms
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION schedule_coordination_private.lock_term_identities();

COMMENT ON TABLE schedule_coordination_private.write_gate IS
  'Unused since 20261021080000 (replaced by identity advisory locks); kept for rollback.';

COMMIT;
