-- Internal-scholarship faculty (مبتعث داخلياً) keep teaching a reduced load at their
-- home college: their quota is max_weekly_hours minus administrative_release_hours,
-- and any hours above it are counted as overtime by the existing workload rules.
-- Until now every new-work guard accepted only availability_status = 'available',
-- so the only way to assign such a lecturer was to misrecord the status.
--
-- One predicate now decides which statuses may receive new assignments/sessions.
-- External scholarship, sabbatical, sick leave and unavailable remain blocked.

CREATE OR REPLACE FUNCTION public.instructor_status_allows_teaching(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT p_status IN ('available', 'internal_scholarship');
$$;

COMMENT ON FUNCTION public.instructor_status_allows_teaching(text) IS
  'Statuses that may receive new teaching assignments and sessions: available, internal_scholarship.';

GRANT EXECUTE ON FUNCTION public.instructor_status_allows_teaching(text) TO authenticated, service_role;

-- Rewrite the four existing checks in place from their live definitions, failing
-- closed if a definition no longer contains the exact expression being replaced.
DO $mig$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.guard_new_work_requires_available_instructor()',
       $q$IF FOUND AND v_status <> 'available' THEN$q$,
       $q$IF FOUND AND NOT public.instructor_status_allows_teaching(v_status) THEN$q$),
      ('public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric)',
       $q$v_ins.availability_status <> 'available'$q$,
       $q$NOT public.instructor_status_allows_teaching(v_ins.availability_status)$q$),
      ('public.get_delivery_group_assignment_candidates(uuid)',
       $q$i.availability_status = 'available'$q$,
       $q$public.instructor_status_allows_teaching(i.availability_status)$q$),
      ('faculty_private.apply_create_assignment(uuid,uuid,numeric,text)',
       $q$v_instructor.availability_status IS DISTINCT FROM 'available'$q$,
       $q$NOT public.instructor_status_allows_teaching(v_instructor.availability_status)$q$)
    ) AS t(fn, old_expr, new_expr)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.new_expr IN v_def) > 0 THEN
      CONTINUE; -- already migrated
    END IF;
    IF (length(v_def) - length(replace(v_def, r.old_expr, ''))) / length(r.old_expr) <> 1 THEN
      RAISE EXCEPTION 'INTERNAL_SCHOLARSHIP_MIGRATION_ANCHOR_MISSING: %', r.fn;
    END IF;
    v_new := replace(v_def, r.old_expr, r.new_expr);
    EXECUTE v_new;
  END LOOP;
END
$mig$;
