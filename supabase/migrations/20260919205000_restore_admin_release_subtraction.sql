-- Restore the approved administrative-release calculation.
-- max_weekly_hours = base weekly quota.
-- administrative_release_hours = hours deducted for the administrative exemption.
-- effective quota = max(0, base - release).
-- Example: base 12, release 3 => effective quota 9.

CREATE OR REPLACE FUNCTION public.effective_instructor_weekly_quota(
  p_base integer,
  p_admin_quota integer
) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_base IS NULL THEN NULL
    ELSE greatest(0, p_base - greatest(0, coalesce(p_admin_quota, 0)))
  END
$$;

COMMENT ON FUNCTION public.effective_instructor_weekly_quota(integer, integer) IS
  'Effective weekly quota = base weekly quota minus administrative release hours, floored at zero.';
