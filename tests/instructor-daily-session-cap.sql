-- Run only in an empty disposable database. All objects/data are rolled back.
BEGIN;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY,schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions,instructor_id uuid NOT NULL,day_of_week integer,replaced_by_split boolean DEFAULT false);
\ir ../supabase/migrations/20260918040000_instructor_daily_session_cap.sql
INSERT INTO public.schedule_versions VALUES('00000000-0000-0000-0000-000000000001','draft');
INSERT INTO public.schedule_sessions SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',0,false FROM generate_series(1,3)n;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.schedule_sessions VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',0,false);
  RAISE EXCEPTION 'fourth session was accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE 'INSTRUCTOR_DAILY_SESSION_LIMIT%' THEN RAISE; END IF;
 END;
END $$;
-- Swaps may temporarily put four meetings on one day, but must end at three.
INSERT INTO public.schedule_sessions VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',1,false);
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.schedule_sessions SET day_of_week=0 WHERE id='00000000-0000-0000-0000-000000000004';
UPDATE public.schedule_sessions SET day_of_week=1 WHERE id='00000000-0000-0000-0000-000000000003';
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO public.schedule_sessions VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',0,true);
-- Historical invalid drafts cannot be approved, even without moving sessions.
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.schedule_sessions SET day_of_week=0 WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
 BEGIN
  UPDATE public.schedule_versions SET status='approved';
  SET CONSTRAINTS instructor_daily_session_cap_approval IMMEDIATE;
  RAISE EXCEPTION 'invalid approval was accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE 'INSTRUCTOR_DAILY_SESSION_LIMIT%' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
