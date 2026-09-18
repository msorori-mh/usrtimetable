BEGIN;
ALTER TABLE public.courses ALTER COLUMN credit_hours DROP NOT NULL;
ALTER TABLE public.instructors ALTER COLUMN max_weekly_hours DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.guard_intake_unknown_catalog_values() RETURNS trigger
LANGUAGE plpgsql SET search_path TO public,pg_temp AS $$
BEGIN
 IF (TG_TABLE_NAME='courses' AND to_jsonb(NEW)->>'credit_hours' IS NULL)
 OR (TG_TABLE_NAME='instructors' AND to_jsonb(NEW)->>'max_weekly_hours' IS NULL) THEN
 IF NOT EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.college_id=NEW.college_id AND t.academic_year='2026-2027' AND t.term_type='first' AND public.existing_schedule_intake_enabled(NEW.college_id,t.id))
 OR NEW.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid THEN
 RAISE EXCEPTION 'UNKNOWN_CATALOG_VALUES_REQUIRE_EXISTING_SCHEDULE_INTAKE';
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_intake_unknown_catalog BEFORE INSERT OR UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_catalog_values();
CREATE TRIGGER zzz_intake_unknown_catalog BEFORE INSERT OR UPDATE ON public.instructors FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_catalog_values();
COMMIT;
