-- Rollback for Q-1. Restores the (insecure) pre-fix grants; only use for
-- emergency rollback.
GRANT EXECUTE ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb)
  TO anon, authenticated;
