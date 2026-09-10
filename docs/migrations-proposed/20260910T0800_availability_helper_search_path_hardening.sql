-- LAUNCH-CLOSURE-SECURITY
-- Narrow hardening: give the four availability helper routines a fixed search_path.
--
-- SCOPE (deliberately minimal):
--   public._avail_time_span(time, time)                 IMMUTABLE, SECURITY INVOKER
--   public._avail_day_span(smallint)                    IMMUTABLE, SECURITY INVOKER
--   public._avail_date_span(date, date)                 IMMUTABLE, SECURITY INVOKER
--   public.validate_room_unavailability_window()        TRIGGER,   SECURITY INVOKER
--
-- WHY pg_catalog AND ONLY pg_catalog:
--   Every identifier the four bodies resolve is a built-in in pg_catalog:
--     tsrange, daterange, int4range, coalesce, the date/time/int casts,
--     the `date + time` operator, to_char, and RAISE (plpgsql, a pg_catalog-resident
--     language). None of them references any object in `public`, in `extensions`,
--     or any user table. Verified against pg_get_functiondef output on production
--     before writing this file.
--   pg_temp is intentionally EXCLUDED so a session-local temporary object can never
--   shadow a built-in during an index-expression evaluation.
--
-- WHY ALTER FUNCTION AND NOT CREATE OR REPLACE:
--   ALTER FUNCTION ... SET only writes pg_proc.proconfig. It does NOT change:
--     * the function OID           -> stored opclass/index-expression references stay valid
--     * provolatile (IMMUTABLE)    -> the expressions remain index-safe
--     * the argument or return types, the body, or the ACL
--   The two GiST exclusion constraints
--     public.instructor_availability_no_overlap
--     public.room_unavailability_no_overlap
--   embed these functions in index expressions and therefore keep working unchanged;
--   no index is rebuilt and no constraint is dropped or recreated.
--
-- NOT IN SCOPE:
--   * No SECURITY DEFINER function is touched (all 81 already carry a fixed search_path).
--   * No EXECUTE grant is granted, revoked or widened.
--   * No policy, table, row or role is changed.
--   * btree_gist is NOT relocated here. See the assessment in
--     docs/LAUNCH-CLOSURE-SECURITY.md: relocation is provably reversible on a disposable
--     cluster but requires `extensions` on the search_path of every future DDL that adds a
--     GiST exclusion constraint, which is a latent break for migrations written later.
--     Left in `public` as an accepted, documented residual.
--
-- Proof: scripts/local-db/availability-temporal-integrity-proof.sh
--        (run with AVAIL_PROOF_EXTRA_SQL pointing at this file; the full 40-case suite,
--         the two-connection concurrency race, the RPCs and the rollback all run AFTER
--         these ALTERs are applied.)

BEGIN;

ALTER FUNCTION public._avail_time_span(time, time) SET search_path = pg_catalog;
ALTER FUNCTION public._avail_day_span(smallint) SET search_path = pg_catalog;
ALTER FUNCTION public._avail_date_span(date, date) SET search_path = pg_catalog;
ALTER FUNCTION public.validate_room_unavailability_window() SET search_path = pg_catalog;

-- Fail loudly rather than silently half-applying.
DO $do$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_avail_time_span', '_avail_day_span', '_avail_date_span',
      'validate_room_unavailability_window'
    )
    AND (p.proconfig IS NULL OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog']));

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'search_path hardening incomplete: % helper(s) still unpinned', v_missing;
  END IF;
END
$do$;

-- Immutability must survive, otherwise the exclusion constraints are no longer index-safe.
DO $do$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('_avail_time_span', '_avail_day_span', '_avail_date_span')
    AND p.provolatile <> 'i';

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'span helper lost IMMUTABLE volatility';
  END IF;
END
$do$;

COMMIT;
