-- PHASE-6 data apply for capacity subgroups / TA fixes / exceptions / room remap / child sessions.
-- INTENTIONALLY BLOCKED: offline simulation reported unscheduled child sessions.
-- Do NOT remove this guard until auto-scheduling is complete and owner re-approves apply.
-- Migration applied: NO (this file must fail if executed).

DO $$
BEGIN
  RAISE EXCEPTION
    'PHASE6_SUBGROUP_DATA_APPLY_DEFERRED: HOLD — SUBGROUP_AUTO_SCHEDULING_INCOMPLETE. Apply schema/RPC migrations only after scheduling completeness is PASS. Source plans: implementation-reports/phase-6-subgroup-data-model-and-auto-scheduling-implementation-01/';
END $$;
