-- Rollback for M-6.
DROP TRIGGER IF EXISTS zz_audit_user_roles ON public.user_roles;
DROP TRIGGER IF EXISTS zz_audit_user_colleges ON public.user_colleges;
DROP TRIGGER IF EXISTS zz_audit_schedule_version_status ON public.schedule_versions;
DROP TRIGGER IF EXISTS zz_audit_schedule_version_delete ON public.schedule_versions;
DROP FUNCTION IF EXISTS security_private.audit_security_change();
