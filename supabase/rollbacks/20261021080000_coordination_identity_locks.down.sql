-- Rollback of 20261021080000_coordination_identity_locks.sql: restores the global write gate.
BEGIN;
DROP TRIGGER IF EXISTS coordination_lock_sessions_insert ON public.schedule_sessions;
DROP TRIGGER IF EXISTS coordination_lock_sessions_update ON public.schedule_sessions;
DROP TRIGGER IF EXISTS coordination_lock_versions_insert ON public.schedule_versions;
DROP TRIGGER IF EXISTS coordination_lock_versions_update ON public.schedule_versions;
DROP TRIGGER IF EXISTS coordination_lock_terms_update ON public.academic_terms;
CREATE TRIGGER coordination_serialize_sessions BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_sessions
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
CREATE TRIGGER coordination_serialize_versions BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_versions
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
CREATE TRIGGER coordination_serialize_terms BEFORE UPDATE OR DELETE ON public.academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
DROP FUNCTION IF EXISTS schedule_coordination_private.lock_term_identities();
DROP FUNCTION IF EXISTS schedule_coordination_private.lock_version_identities();
DROP FUNCTION IF EXISTS schedule_coordination_private.lock_session_identities();
DROP FUNCTION IF EXISTS schedule_coordination_private.lock_identity_keys(bigint[]);
DROP FUNCTION IF EXISTS schedule_coordination_private.identity_lock_key(uuid);
COMMIT;
