-- Rollback of 20261025090000_user_feature_flags.sql.
-- The application must be rolled back to the e-mail-based greeting first
-- (src/lib/viewer-roles.ts), otherwise the flagged account shows the default title.
DROP TABLE IF EXISTS public.user_feature_flags;
