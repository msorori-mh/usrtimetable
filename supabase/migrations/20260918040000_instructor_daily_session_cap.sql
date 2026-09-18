-- Three actual meetings per instructor/day, across regular and parallel systems.
-- Deferred checks permit atomic swaps without accepting an invalid final state.
CREATE OR REPLACE FUNCTION public.enforce_instructor_daily_session_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_version uuid;
BEGIN
 IF TG_TABLE_NAME='schedule_versions' THEN
   IF NEW.status NOT IN ('approved','published') THEN RETURN NEW; END IF;
   v_version:=NEW.id;
 ELSE
   v_version:=NEW.schedule_version_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,9174));
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   WHERE s.schedule_version_id=v_version AND NOT coalesce(s.replaced_by_split,false)
   GROUP BY s.instructor_id,s.day_of_week HAVING count(*)>3) THEN
   RAISE EXCEPTION 'INSTRUCTOR_DAILY_SESSION_LIMIT: maximum 3 sessions per instructor per day'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_instructor_daily_session_cap() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER instructor_daily_session_cap_final
AFTER INSERT OR UPDATE ON public.schedule_sessions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_daily_session_cap();
CREATE CONSTRAINT TRIGGER instructor_daily_session_cap_approval
AFTER INSERT OR UPDATE ON public.schedule_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_daily_session_cap();
