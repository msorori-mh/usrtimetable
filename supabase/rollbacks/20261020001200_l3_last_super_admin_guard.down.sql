-- Rollback for L-3.
DROP TRIGGER IF EXISTS trg_prevent_last_super_admin ON public.user_roles;
DROP FUNCTION IF EXISTS public.prevent_last_super_admin_removal();
