-- M-8 (track C): server student overlap follows memberships, merged lectures and partitions.
-- Disposable replayed database only; rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/sched-integrity.sql
SET CONSTRAINTS ALL IMMEDIATE;

DO $t$
DECLARE r jsonb;
BEGIN
  -- Two disjoint lab partitions of cohort c1 in parallel: no student clash.
  r := public._sb_v2_delivery_group_overlap(tsched.id('ver-a'), tsched.id('dg-lab2'), tsched.id('c1'),
    5, '10:00', '12:00', tsched.id('s-lab2'));
  PERFORM tsched.assert(jsonb_array_length(r) = 0, 'disjoint partitions blocked: ' || r::text);
  r := public.compute_version_hard_conflicts(tsched.id('ver-a'));
  PERFORM tsched.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'conflicts') c
    WHERE c->>'code' = 'delivery_group_conflict'), 'version-wide: disjoint partitions reported');

  -- The merged lecture is stored once, on cohort c2's anchor group; cohort c1 attends it
  -- through its member group. A c1 lab at the same time is a real student clash.
  r := public._sb_v2_delivery_group_overlap(tsched.id('ver-a'), tsched.id('dg-lab1'), tsched.id('c1'),
    5, '08:00', '10:00', tsched.id('s-lab1'));
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(r) c
    WHERE c->>'related_session_id' = tsched.id('s-anchor')::text), 'merged lecture clash missed: ' || r::text);

  -- The member group itself overlaps both lab partitions.
  r := public._sb_v2_delivery_group_overlap(tsched.id('ver-a'), tsched.id('dg-member'), tsched.id('c1'),
    5, '10:00', '12:00', NULL);
  PERFORM tsched.assert(jsonb_array_length(r) = 2, 'member group vs both labs: ' || r::text);
END $t$;

-- Place the lab on the merged lecture's slot (server role, outside the RPCs).
ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_schedule_session_current_delivery_group;
UPDATE public.schedule_sessions SET start_time = '08:00', end_time = '10:00' WHERE id = tsched.id('s-lab1');
ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_schedule_session_current_delivery_group;
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.compute_version_hard_conflicts(tsched.id('ver-a'));
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(r->'conflicts') c
    WHERE c->>'code' = 'delivery_group_conflict'
      AND tsched.id('s-anchor')::text IN (c->>'schedule_session_id', c->>'related_session_id')
      AND tsched.id('s-lab1')::text IN (c->>'schedule_session_id', c->>'related_session_id')),
    'version-wide merged-lecture clash missed: ' || (r - 'conflicts')::text);
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'exactly one clash: ' || (r->'conflicts')::text);
END $t$;
ROLLBACK;
SELECT 'PASS: sched-student-overlap-db (M-8)' AS result;
