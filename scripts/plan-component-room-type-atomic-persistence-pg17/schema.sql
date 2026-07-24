\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.colleges (id uuid PRIMARY KEY, code text UNIQUE NOT NULL);
CREATE TABLE public.academic_programs (
  id uuid PRIMARY KEY, college_id uuid NOT NULL REFERENCES public.colleges(id), code text NOT NULL
);
CREATE TABLE public.app_user_access (
  user_id uuid NOT NULL, college_id uuid NOT NULL, role text NOT NULL, active boolean NOT NULL,
  PRIMARY KEY (user_id, college_id)
);
CREATE TABLE public.study_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  program_id uuid NOT NULL REFERENCES public.academic_programs(id), code text NOT NULL,
  version text NOT NULL DEFAULT '1', name text NOT NULL DEFAULT 'plan', is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (program_id, code, version)
);
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (college_id, code)
);
CREATE TABLE public.plan_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  study_plan_id uuid NOT NULL REFERENCES public.study_plans(id),
  course_id uuid NOT NULL REFERENCES public.courses(id), semester integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (study_plan_id, course_id)
);
CREATE TABLE public.room_types (
  id uuid PRIMARY KEY, college_id uuid NOT NULL REFERENCES public.colleges(id),
  code text NOT NULL, is_active boolean NOT NULL, default_capacity integer NOT NULL
);
CREATE TABLE public.plan_course_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  plan_course_id uuid NOT NULL REFERENCES public.plan_courses(id), component_type text NOT NULL,
  weekly_contact_hours numeric NOT NULL, is_timetabled boolean NOT NULL,
  counts_toward_regular_load boolean NOT NULL, counts_toward_overtime boolean NOT NULL,
  compensation_mode text NOT NULL, required_room_type_id uuid REFERENCES public.room_types(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pcc_unique UNIQUE (plan_course_id, component_type)
);
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  target_entity text NOT NULL, mode text NOT NULL, status text NOT NULL,
  created_by uuid NOT NULL, validated_payload jsonb NOT NULL, payload_manifest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  inserted_rows integer DEFAULT 0, updated_rows integer DEFAULT 0, skipped_rows integer DEFAULT 0,
  claimed_at timestamptz, finished_at timestamptz
);
CREATE TABLE public.audit_logs (
  id bigserial PRIMARY KEY, actor_id uuid, action text NOT NULL, entity text NOT NULL,
  entity_id uuid, college_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.can_manage_college(p_user uuid, p_college uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_access
    WHERE user_id = p_user AND college_id = p_college AND active
      AND role IN ('super_admin', 'college_admin')
  )
$$;
CREATE FUNCTION public.import_manager_actor(p_college_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'college import access denied' USING ERRCODE='42501';
  END IF;
  RETURN v_actor;
END $$;
CREATE FUNCTION public._import_row_values(elem jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(elem->'values', elem) $$;
CREATE FUNCTION public._import_is_elective_placeholder(code text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(upper(btrim(code)) ~ '\(E\)$', false)
$$;
CREATE FUNCTION public._import_mode_action(p_mode text, p_exists boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_exists AND p_mode='insert_only' THEN 'skip'
    WHEN p_exists THEN 'update'
    WHEN NOT p_exists AND p_mode='update_existing' THEN 'skip'
    ELSE 'insert'
  END
$$;

-- Historical helper signatures inspected by the source-only preflight. The
-- minimal legacy commit below models their combined behavior directly.
CREATE FUNCTION public._import_apply_study_plan(uuid, text, jsonb)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

CREATE FUNCTION public._import_sync_plan_course_components(uuid, uuid, jsonb)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;

-- Minimal historical implementation: atomic at job level, but intentionally
-- omits required_room_type_id exactly like the production source being corrected.
CREATE FUNCTION public.commit_import_job_atomic(
  p_job_id uuid, p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public.import_jobs%ROWTYPE; elem jsonb; v jsonb; comp jsonb;
  actor uuid; v_plan_id uuid; v_course_id uuid; pc_id uuid; existed boolean;
  ins integer:=0; upd integer:=0; skp integer:=0; action_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import job not found'; END IF;
  actor := public.import_manager_actor(j.college_id);
  IF j.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'actor mismatch' USING ERRCODE='42501'; END IF;
  IF j.status='committed' THEN
    RETURN jsonb_build_object('status','ok','inserted',j.inserted_rows,'updated',j.updated_rows,
      'skipped',j.skipped_rows,'failed',0,'replay',true,'job_id',j.id);
  END IF;
  IF j.status<>'preview' THEN RAISE EXCEPTION 'not preview'; END IF;
  IF p_expected_updated_at IS NOT NULL AND j.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale' USING ERRCODE='40001';
  END IF;
  IF j.payload_manifest IS DISTINCT FROM md5(j.validated_payload::text) THEN
    RAISE EXCEPTION 'manifest mismatch';
  END IF;
  FOR elem IN SELECT value FROM jsonb_array_elements(j.validated_payload) LOOP
    v := public._import_row_values(elem);
    INSERT INTO public.study_plans(college_id,program_id,code,version,name)
      VALUES(j.college_id,(v->>'_program_id')::uuid,v->>'plan_code',
        COALESCE(NULLIF(v->>'plan_version',''),'1'),COALESCE(v->>'plan_name','plan'))
      ON CONFLICT(program_id,code,version) DO UPDATE SET name=EXCLUDED.name
      RETURNING id INTO v_plan_id;
    INSERT INTO public.courses(college_id,code,name)
      VALUES(j.college_id,v->>'course_code',v->>'course_name')
      ON CONFLICT(college_id,code) DO UPDATE SET name=EXCLUDED.name
      RETURNING id INTO v_course_id;
    SELECT EXISTS(
      SELECT 1
      FROM public.plan_courses AS pc
      WHERE pc.study_plan_id=v_plan_id
        AND pc.course_id=v_course_id
    )
      INTO existed;
    action_name := public._import_mode_action(j.mode, existed);
    IF action_name='skip' THEN skp:=skp+1; CONTINUE; END IF;
    INSERT INTO public.plan_courses(college_id,study_plan_id,course_id,semester)
      VALUES(j.college_id,v_plan_id,v_course_id,COALESCE((v->>'semester')::int,1))
      ON CONFLICT(study_plan_id,course_id) DO UPDATE SET semester=EXCLUDED.semester
      RETURNING id INTO pc_id;
    IF existed THEN upd:=upd+1; ELSE ins:=ins+1; END IF;
    FOR comp IN SELECT value FROM jsonb_array_elements(v->'_plan_component_sync') LOOP
      INSERT INTO public.plan_course_components(
        college_id,plan_course_id,component_type,weekly_contact_hours,is_timetabled,
        counts_toward_regular_load,counts_toward_overtime,compensation_mode
      ) VALUES(
        j.college_id,pc_id,comp->>'component_type',
        COALESCE((comp->>'hours')::numeric,(comp->>'weekly_contact_hours')::numeric),
        (comp->>'is_timetabled')::boolean,(comp->>'counts_toward_regular_load')::boolean,
        (comp->>'counts_toward_overtime')::boolean,comp->>'compensation_mode'
      ) ON CONFLICT(plan_course_id,component_type) DO UPDATE SET
        weekly_contact_hours=EXCLUDED.weekly_contact_hours,
        is_timetabled=EXCLUDED.is_timetabled;
    END LOOP;
  END LOOP;
  UPDATE public.import_jobs SET status='committed',inserted_rows=ins,updated_rows=upd,
    skipped_rows=skp,finished_at=clock_timestamp() WHERE id=j.id;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(actor,'import_job_committed','import_'||j.target_entity,j.id,j.college_id,'{}');
  RETURN jsonb_build_object('status','ok','inserted',ins,'updated',upd,'skipped',skp,
    'failed',0,'replay',false,'job_id',j.id,'entity',j.target_entity,'mode',j.mode,
    'college_id',j.college_id,'payload_manifest',j.payload_manifest);
END $$;
GRANT EXECUTE ON FUNCTION public.commit_import_job_atomic(uuid,timestamptz)
  TO authenticated, service_role;
