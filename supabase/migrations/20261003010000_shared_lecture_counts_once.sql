BEGIN;
-- A shared (merged) lecture must count once in teaching load.
--
-- Merges made inside a schedule version live only in
-- schedule_version_delivery_private.shared_link_facts. The operational load
-- readers (v_instructor_delivery_workload, the assignment workspace and the
-- load preview) only knew the stored delivery_groups flag
-- excluded_from_standard_workload, so an active assignment left on a merged
-- member group was added on top of the anchor lecture: one lecture, counted
-- twice. Observed on the published ITCS timetable of 2026-10-03 (22 hours for
-- seven lecturers) and corrected there by hand.
--
-- This makes the rule structural for every college: a delivery group that is a
-- merged member in the published timetable of its college and term, and has no
-- session of its own there, carries no standard load. Every reader already
-- keys on the same "excluded from standard workload" test, so the rule is
-- added to that test in each of them. No assignment, session, merge or stored
-- flag is changed.
CREATE OR REPLACE FUNCTION public.delivery_group_shared_in_published(p_group uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM schedule_version_delivery_private.shared_link_facts l
    JOIN public.schedule_versions v ON v.id = l.version_id
    WHERE l.member_group_id = p_group
      AND v.status = 'published'
      -- Only the newest published timetable of that college and term decides.
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_versions later
        WHERE later.college_id = v.college_id
          AND later.academic_term_id = v.academic_term_id
          AND later.status = 'published'
          AND later.created_at > v.created_at)
      -- A member that is taught separately in that timetable still counts.
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_sessions s
        WHERE s.schedule_version_id = v.id AND s.delivery_group_id = p_group)
  )
$function$;

REVOKE ALL ON FUNCTION public.delivery_group_shared_in_published(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_group_shared_in_published(uuid) TO authenticated, service_role;

DO $patch$
DECLARE
  t record;
  d text;
  n integer;
  before_text text;
  after_text text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('view', 'public.v_instructor_delivery_workload',
     'dg'),
    ('function', 'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)',
     'dg'),
    ('function', 'public.list_teaching_assignment_workspace_for_version(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text)',
     'dg'),
    ('function', 'public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)',
     'dg'),
    ('function', 'public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)',
     'v_dg')
  ) AS x(kind, target, alias) LOOP
    before_text := format('COALESCE(%s.excluded_from_standard_workload, false)', t.alias);
    after_text := format('(COALESCE(%1$s.excluded_from_standard_workload, false) OR public.delivery_group_shared_in_published(%1$s.id))', t.alias);
    IF t.kind = 'view' THEN
      d := pg_get_viewdef(t.target::regclass, true);
    ELSE
      d := pg_get_functiondef(t.target::regprocedure);
    END IF;
    -- Already patched for this alias (a view is stored re-formatted, so match
    -- on the call rather than on the exact replacement text): nothing to do.
    CONTINUE WHEN position(format('delivery_group_shared_in_published(%s.id)', t.alias) IN d) > 0;
    n := (length(d) - length(replace(d, before_text, ''))) / length(before_text);
    IF n <> 1 THEN
      RAISE EXCEPTION 'SHARED_LECTURE_LOAD_DRIFT: expected 1 occurrence of % in %, found %',
        before_text, t.target, n;
    END IF;
    d := replace(d, before_text, after_text);
    IF t.kind = 'view' THEN
      EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', t.target, d);
    ELSE
      EXECUTE d;
    END IF;
  END LOOP;
END $patch$;

COMMIT;
