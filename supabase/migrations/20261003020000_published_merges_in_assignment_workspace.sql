BEGIN;
-- The assignment workspace must present a lecture merged in the published
-- timetable the way it presents a globally linked one: a single row on the
-- anchor group naming every cohort that attends, with the member group not
-- listed on its own.
--
-- Until now only public.shared_lecture_links was read there. A merge made in a
-- schedule version left the member group as a separate row carrying whatever
-- assignment was last stored on it, so the page could name a lecturer who does
-- not teach that cohort (seen on the published ITCS timetable of 2026-10-03).
--
-- Read model only. No assignment, session, merge or stored flag is changed.
CREATE OR REPLACE FUNCTION public.published_shared_lecture_members(p_anchor uuid)
RETURNS TABLE(group_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT l.member_group_id
  FROM schedule_version_delivery_private.shared_link_facts l
  JOIN public.schedule_versions v ON v.id = l.version_id
  WHERE l.anchor_group_id = p_anchor
    AND public.delivery_group_shared_in_published(l.member_group_id)
    AND v.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_versions later
      WHERE later.college_id = v.college_id
        AND later.academic_term_id = v.academic_term_id
        AND later.status = 'published'
        AND later.created_at > v.created_at)
$function$;

CREATE OR REPLACE FUNCTION public.operational_shared_lecture_group_ids(p_group uuid)
RETURNS TABLE(group_id uuid)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT g.group_id FROM public.shared_lecture_group_ids(p_group) g
  UNION
  SELECT m.group_id FROM public.published_shared_lecture_members(p_group) m
$function$;

CREATE OR REPLACE FUNCTION public.operational_shared_lecture_matches(
  p_group uuid, p_cohort uuid DEFAULT NULL::uuid, p_system text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.operational_shared_lecture_group_ids(p_group) m
    JOIN public.delivery_groups g ON g.id = m.group_id
    JOIN public.academic_cohorts c ON c.id = g.cohort_id
    WHERE (p_cohort IS NULL OR c.id = p_cohort)
      AND (p_system IS NULL OR c.study_system = p_system))
$function$;

REVOKE ALL ON FUNCTION public.published_shared_lecture_members(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operational_shared_lecture_group_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operational_shared_lecture_matches(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.published_shared_lecture_members(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.operational_shared_lecture_group_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.operational_shared_lecture_matches(uuid, uuid, text) TO authenticated, service_role;

DO $patch$
DECLARE
  target text;
  p record;
  d text;
  n integer;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)',
    'public.list_teaching_assignment_workspace_for_version(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text)'
  ] LOOP
    d := pg_get_functiondef(target::regprocedure);
    -- Already patched: nothing to do.
    CONTINUE WHEN position('public.operational_shared_lecture_group_ids(' IN d) > 0;
    FOR p IN SELECT * FROM (VALUES
      -- 1. Cohort labels, head counts and the program/level filters follow
      --    the published merges as well as the global links.
      (4, $b1$public.shared_lecture_group_ids($b1$,
          $a1$public.operational_shared_lecture_group_ids($a1$),
      -- 2. So do the cohort and study-system filters.
      (1, $b2$public.shared_lecture_matches(dg.id, p_cohort_id, p_study_system)$b2$,
          $a2$public.operational_shared_lecture_matches(dg.id, p_cohort_id, p_study_system)$a2$),
      -- 3. A member merged in the published timetable is not a row of its own.
      (1, $b3$WHERE sl.member_group_id = dg.id
      )$b3$,
          $a3$WHERE sl.member_group_id = dg.id
      )
      AND NOT public.delivery_group_shared_in_published(dg.id)$a3$),
      -- 4. Its anchor is labelled as a merged lecture.
      (1, $b4$WHERE sl.anchor_group_id = dg.id
      ) AS has_shared_members$b4$,
          $a4$WHERE sl.anchor_group_id = dg.id
      ) OR EXISTS (
        SELECT 1 FROM public.published_shared_lecture_members(dg.id)
      ) AS has_shared_members$a4$)
    ) AS patches(expected, before_text, after_text) LOOP
      n := (length(d) - length(replace(d, p.before_text, ''))) / length(p.before_text);
      IF n <> p.expected THEN
        RAISE EXCEPTION 'PUBLISHED_MERGE_WORKSPACE_DRIFT: expected % occurrence(s) of % in %, found %',
          p.expected, p.before_text, target, n;
      END IF;
      d := replace(d, p.before_text, p.after_text);
    END LOOP;
    EXECUTE d;
  END LOOP;
END $patch$;

COMMIT;
