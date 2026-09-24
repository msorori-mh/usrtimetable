-- Run in an empty disposable PostgreSQL database; no production data.
BEGIN;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END
$roles$;
CREATE TABLE public.colleges (id uuid PRIMARY KEY, code text NOT NULL);
CREATE TABLE public.plan_course_components (id uuid PRIMARY KEY, component_type text);
CREATE TABLE public.teaching_assignments (
  id uuid PRIMARY KEY, college_id uuid NOT NULL, plan_course_component_id uuid, session_type text
);
CREATE FUNCTION public._ss_ci(c text,s text,sid uuid,rid uuid,m jsonb)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('code',c,'severity',s,'schedule_session_id',sid,'metadata',m)
$fn$;
-- The other conflict helpers are provided by the full application schema.
SET check_function_bodies = off;
\ir ../supabase/migrations/20260924090000_itcs_theory_to_14.sql
SET check_function_bodies = on;

INSERT INTO public.colleges VALUES
  ('00000000-0000-0000-0000-000000000001','ITCS'),
  ('00000000-0000-0000-0000-000000000002','EDU');
INSERT INTO public.plan_course_components VALUES
  ('00000000-0000-0000-0000-000000000011','theory'),
  ('00000000-0000-0000-0000-000000000012','practical'),
  ('00000000-0000-0000-0000-000000000013','tutorial');
INSERT INTO public.teaching_assignments VALUES
  ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','lecture'),
  ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','lecture'),
  ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011','lecture'),
  ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','tutorial'),
  ('00000000-0000-0000-0000-000000000025','00000000-0000-0000-0000-000000000001',NULL,'lecture');

DO $tests$
DECLARE
  sid uuid := '00000000-0000-0000-0000-000000000099';
  itcs uuid := '00000000-0000-0000-0000-000000000001';
  edu uuid := '00000000-0000-0000-0000-000000000002';
  conflicts jsonb;
  collector text;
BEGIN
  conflicts := public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000021','16:00');
  IF jsonb_array_length(conflicts) <> 1 OR conflicts->0->>'code' <> 'itcs_theory_after_14'
     OR conflicts->0->>'severity' <> 'hard' THEN
    RAISE EXCEPTION 'ITCS late theory was accepted: %', conflicts;
  END IF;
  IF public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000021','14:00') <> '[]'::jsonb
     OR public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000021','15:00')->0->>'code' <> 'itcs_theory_after_14'
     OR public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000024','16:00')->0->>'code' <> 'itcs_theory_after_14'
     OR public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000025','16:00')->0->>'code' <> 'itcs_theory_after_14' THEN
    RAISE EXCEPTION 'ITCS theory boundary, tutorial or legacy lecture failed';
  END IF;
  IF public._ss_itcs_theory_hours(sid,itcs,'00000000-0000-0000-0000-000000000022','16:00') <> '[]'::jsonb
     OR public._ss_itcs_theory_hours(sid,edu,'00000000-0000-0000-0000-000000000023','16:00') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Practical lab or other college was blocked';
  END IF;
  SELECT pg_get_functiondef('public._ss_gather(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time without time zone,time without time zone,uuid)'::regprocedure)
    INTO collector;
  IF position('public._ss_itcs_theory_hours(a,b,g,l)' IN collector) = 0 THEN
    RAISE EXCEPTION 'Authoritative collector does not include ITCS cutoff';
  END IF;
END
$tests$;
ROLLBACK;
