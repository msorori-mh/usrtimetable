BEGIN;
-- Removes the added anchor-cohort row source; nothing else was changed.
DO $unpatch$
DECLARE
  target constant regprocedure :=
    'public.schedule_version_student_memberships(uuid,uuid[])'::regprocedure;
  added constant text := $a$
    UNION ALL
    -- The anchor's own cohort attends the shared lecture too, even when it
    -- has no partition rows of its own.
    SELECT r.id,r.own_cohort,NULL::uuid,NULL::integer,true
    FROM requested r
    WHERE EXISTS (SELECT 1 FROM links l WHERE l.anchor_group_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id=r.id)$a$;
BEGIN
  EXECUTE replace(pg_get_functiondef(target), added, '');
END $unpatch$;
COMMIT;
