-- Add separately: PostgreSQL requires committing an enum value before using it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'university_leadership';
