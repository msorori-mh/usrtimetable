-- H-3: v_instructor_delivery_workload lost security_invoker when it was
-- re-created with a plain CREATE OR REPLACE VIEW (20260911214530 and later), so
-- it ran with the owner's rights and bypassed RLS on teaching_assignments /
-- instructors: any authenticated user could read every college's workload.
-- Set security_invoker on every view in public that lacks it. SECURITY DEFINER
-- readers (get_faculty_university_report, faculty_private.workload,
-- get_system_hours_report, teaching_payroll, get_teaching_coverage_report) run
-- as the owner and keep seeing all rows.
ALTER VIEW public.v_instructor_delivery_workload SET (security_invoker = true);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS v
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'v'
       AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false)
       AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=on'], false)
  LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker = true)', r.v);
  END LOOP;
END $$;
