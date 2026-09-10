-- LAUNCH-CLOSURE-03 — disposable-database FIXTURE.
-- Recreates ONLY the structures the availability migration touches, copied from the
-- live schema (`\d public.instructor_availability`, `\d public.room_unavailability`),
-- plus minimal stand-ins for Supabase's auth.uid() and the college-isolation helpers.
--
-- Never run against production. This file creates roles and tables from scratch.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Supabase-compatible auth.uid(): reads the JWT claims GUC.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Minimal tenancy model
-- ---------------------------------------------------------------------------
CREATE TABLE public.colleges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL
);

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE public.user_colleges (
  user_id uuid NOT NULL,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  PRIMARY KEY (user_id, college_id)
);

CREATE OR REPLACE FUNCTION public.can_manage_college(p_user uuid, p_college uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles r
             WHERE r.user_id = p_user AND r.role = 'super_admin')
    OR EXISTS (SELECT 1 FROM public.user_roles r
               JOIN public.user_colleges c ON c.user_id = r.user_id
               WHERE r.user_id = p_user AND r.role = 'college_admin'
                 AND c.college_id = p_college)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_college(p_user uuid, p_college uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND (
    public.can_manage_college(p_user, p_college)
    OR EXISTS (SELECT 1 FROM public.user_colleges c
               WHERE c.user_id = p_user AND c.college_id = p_college)
    OR EXISTS (SELECT 1 FROM public.user_roles r
               WHERE r.user_id = p_user AND r.role = 'institutional_viewer')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_college(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_college(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------
CREATE TABLE public.instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  full_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.scheduling_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL UNIQUE REFERENCES public.colleges(id),
  working_days int[]
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Structure copied from live `\d` output, including nullability.
CREATE TABLE public.instructor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  instructor_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  availability_type text NOT NULL DEFAULT 'available',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_preference boolean NOT NULL DEFAULT false,
  CONSTRAINT instructor_availability_check CHECK (end_time > start_time),
  CONSTRAINT instructor_availability_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6)
);

CREATE TABLE public.room_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  day_of_week smallint,
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_unavailability_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6)
);

-- Cross-college integrity triggers, mirroring live ensure_ia_college / ensure_ru_college.
CREATE OR REPLACE FUNCTION public.ensure_ia_college()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.instructors i
                 WHERE i.id = NEW.instructor_id AND i.college_id = NEW.college_id) THEN
    RAISE EXCEPTION 'instructor/college mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_ru_college()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms r
                 WHERE r.id = NEW.room_id AND r.college_id = NEW.college_id) THEN
    RAISE EXCEPTION 'room/college mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ia_college BEFORE INSERT OR UPDATE ON public.instructor_availability
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ia_college();
CREATE TRIGGER trg_ru_college BEFORE INSERT OR UPDATE ON public.room_unavailability
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ru_college();

-- Grants and policies copied from the live database.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

ALTER TABLE public.instructor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY ia_select ON public.instructor_availability FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ia_insert ON public.instructor_availability FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ia_update ON public.instructor_availability FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ia_delete ON public.instructor_availability FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE POLICY ru_select ON public.room_unavailability FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ru_insert ON public.room_unavailability FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ru_update ON public.room_unavailability FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ru_delete ON public.room_unavailability FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE POLICY ss_select ON public.scheduling_settings FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
CREATE POLICY al_select ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY i_select ON public.instructors FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY r_select ON public.rooms FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));

-- ---------------------------------------------------------------------------
-- Deterministic seed data (TEST ONLY, fixed UUIDs so cases can reference them)
-- ---------------------------------------------------------------------------
INSERT INTO public.colleges (id, code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'COL-A'),
  ('22222222-2222-2222-2222-222222222222', 'COL-B');

-- admin of COL-A, admin of COL-B, and a read-only viewer of COL-A
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'college_admin'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'college_admin'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'read_only');
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.instructors (id, college_id, full_name) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'TEST Lecturer A'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'TEST Lecturer B');

INSERT INTO public.rooms (id, college_id, code) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'TEST-ROOM-A');

INSERT INTO public.scheduling_settings (college_id, working_days) VALUES
  ('11111111-1111-1111-1111-111111111111', ARRAY[6, 0, 1, 2, 3, 4]);
