-- College dean is a read-only, single-college executive role.
-- PostgreSQL enum values must be committed before they are referenced.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'college_dean';
