-- Rollback for H-3 (restores the insecure owner-rights view).
ALTER VIEW public.v_instructor_delivery_workload RESET (security_invoker);
