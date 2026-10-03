BEGIN;
-- A merged lecture is attended by the anchor group's own cohort as well as by
-- the merged members.
--
-- public.schedule_version_student_memberships answers "which cohorts attend
-- this group in this version". For an anchor whose own cohort has no partition
-- rows it returned only the merged member cohorts, because the fallback to the
-- group's own cohort is taken only when no membership row exists at all. Every
-- reader of that answer (student timetables, the conflict engine, the
-- scheduler) then treated the anchor cohort as not attending its own lecture.
--
-- Add the anchor's own cohort in that case, the same way a member without
-- partitions is already exposed. Purely additive: no existing row changes.
DO $patch$
DECLARE
  target constant regprocedure :=
    'public.schedule_version_student_memberships(uuid,uuid[])'::regprocedure;
  before_text constant text := $b$    WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=g.id)
  ), sized AS MATERIALIZED ($b$;
  after_text constant text := $a$    WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=g.id)
    UNION ALL
    -- The anchor's own cohort attends the shared lecture too, even when it
    -- has no partition rows of its own.
    SELECT r.id,r.own_cohort,NULL::uuid,NULL::integer,true
    FROM requested r
    WHERE EXISTS (SELECT 1 FROM links l WHERE l.anchor_group_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=r.id)
  ), sized AS MATERIALIZED ($a$;
  d text;
  n integer;
BEGIN
  d := pg_get_functiondef(target);
  -- Already patched: nothing to do.
  IF position('SELECT r.id,r.own_cohort,NULL::uuid,NULL::integer,true' IN d) > 0 THEN
    RETURN;
  END IF;
  n := (length(d) - length(replace(d, before_text, ''))) / length(before_text);
  IF n <> 1 THEN
    RAISE EXCEPTION 'SHARED_ANCHOR_MEMBERSHIP_DRIFT: expected 1 occurrence, found %', n;
  END IF;
  EXECUTE replace(d, before_text, after_text);
END $patch$;

COMMIT;
