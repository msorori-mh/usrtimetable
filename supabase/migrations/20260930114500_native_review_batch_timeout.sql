-- The native import validates the full assignment batch and timetable in one
-- transaction. Keep a bounded timeout while allowing the complete check/save.
BEGIN;
ALTER FUNCTION public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)
 SET statement_timeout='180s';
NOTIFY pgrst,'reload schema';
COMMIT;
