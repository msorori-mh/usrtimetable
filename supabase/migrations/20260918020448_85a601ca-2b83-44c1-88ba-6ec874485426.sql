
CREATE TABLE public.existing_schedule_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.academic_terms(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, term_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.existing_schedule_intake TO authenticated;
GRANT ALL ON public.existing_schedule_intake TO service_role;
ALTER TABLE public.existing_schedule_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY esi_select ON public.existing_schedule_intake FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY esi_insert ON public.existing_schedule_intake FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY esi_update ON public.existing_schedule_intake FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY esi_delete ON public.existing_schedule_intake FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.guard_existing_schedule_intake_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_name text; v_term_college uuid;
BEGIN
  SELECT name INTO v_name FROM public.colleges WHERE id = NEW.college_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'COLLEGE_NOT_FOUND'; END IF;
  IF COALESCE(NEW.enabled,false) AND v_name LIKE '%تكنولوجيا المعلومات%' THEN
    RAISE EXCEPTION 'EXISTING_SCHEDULE_INTAKE_FORBIDDEN_FOR_IT' USING ERRCODE='23514';
  END IF;
  SELECT college_id INTO v_term_college FROM public.academic_terms WHERE id = NEW.term_id;
  IF v_term_college IS DISTINCT FROM NEW.college_id THEN
    RAISE EXCEPTION 'TERM_COLLEGE_MISMATCH' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_esi_scope BEFORE INSERT OR UPDATE ON public.existing_schedule_intake
FOR EACH ROW EXECUTE FUNCTION public.guard_existing_schedule_intake_scope();

CREATE OR REPLACE FUNCTION public.existing_schedule_intake_enabled(p_college uuid, p_term uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.existing_schedule_intake i
    WHERE i.college_id = p_college AND i.term_id = p_term AND i.enabled
  );
$$;

CREATE OR REPLACE FUNCTION public.existing_schedule_intake_version(p_version uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schedule_versions v
    JOIN public.existing_schedule_intake i
      ON i.college_id = v.college_id AND i.term_id = v.academic_term_id AND i.enabled
    WHERE v.id = p_version
  );
$$;

CREATE TABLE public.existing_schedule_source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.academic_terms(id) ON DELETE CASCADE,
  schedule_version_id uuid REFERENCES public.schedule_versions(id) ON DELETE SET NULL,
  source_id text NOT NULL,
  source_file text NOT NULL,
  source_cell text NOT NULL,
  study_plan_id uuid REFERENCES public.study_plans(id) ON DELETE SET NULL,
  level_number integer,
  raw_course text,
  raw_teacher text,
  raw_day text,
  raw_time text,
  raw_room text,
  day_of_week smallint,
  start_time time,
  end_time time,
  plan_course_id uuid REFERENCES public.plan_courses(id) ON DELETE SET NULL,
  component_id uuid REFERENCES public.plan_course_components(id) ON DELETE SET NULL,
  instructor_ids uuid[] NOT NULL DEFAULT '{}',
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  shared_key text,
  cohort_id uuid REFERENCES public.academic_cohorts(id) ON DELETE SET NULL,
  delivery_group_id uuid REFERENCES public.delivery_groups(id) ON DELETE SET NULL,
  teaching_assignment_id uuid REFERENCES public.teaching_assignments(id) ON DELETE SET NULL,
  schedule_session_id uuid REFERENCES public.schedule_sessions(id) ON DELETE SET NULL,
  shared_member boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  pending_reasons text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, term_id, source_id),
  CONSTRAINT essr_status_chk CHECK (status = ANY (ARRAY['pending','ready','imported','shared_member']))
);

CREATE INDEX essr_lookup_idx ON public.existing_schedule_source_rows (college_id, term_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.existing_schedule_source_rows TO authenticated;
GRANT ALL ON public.existing_schedule_source_rows TO service_role;
ALTER TABLE public.existing_schedule_source_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY essr_select ON public.existing_schedule_source_rows FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY essr_insert ON public.existing_schedule_source_rows FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY essr_update ON public.existing_schedule_source_rows FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY essr_delete ON public.existing_schedule_source_rows FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE TRIGGER trg_essr_updated BEFORE UPDATE ON public.existing_schedule_source_rows
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Scoped exception: existing-schedule intake keeps real historic times untouched.
CREATE OR REPLACE FUNCTION public.enforce_instructor_daily_session_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_version uuid;
BEGIN
 IF TG_TABLE_NAME='schedule_versions' THEN
   IF NEW.status NOT IN ('approved','published') THEN RETURN NEW; END IF;
   v_version:=NEW.id;
 ELSE
   v_version:=NEW.schedule_version_id;
 END IF;
 IF public.existing_schedule_intake_version(v_version) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,9174));
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   WHERE s.schedule_version_id=v_version AND NOT coalesce(s.replaced_by_split,false)
   GROUP BY s.instructor_id,s.day_of_week HAVING count(*)>3) THEN
   RAISE EXCEPTION 'INSTRUCTOR_DAILY_SESSION_LIMIT: maximum 3 sessions per instructor per day'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_schedule_session_current_delivery_group()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_source public.delivery_groups%ROWTYPE; v_fresh jsonb;
BEGIN
  IF NEW.delivery_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_source FROM public.delivery_groups WHERE id=NEW.delivery_group_id;
  IF NOT FOUND OR COALESCE(v_source.active,true)=false OR COALESCE(v_source.is_obsolete,false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  IF public.existing_schedule_intake_version(NEW.schedule_version_id) THEN RETURN NEW; END IF;
  v_fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id);
  IF COALESCE((v_fresh->>'ok')::boolean,false)=false THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE' USING ERRCODE='23514',DETAIL=v_fresh::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
 v_base numeric; v_release numeric; v_rank text; v_term uuid; v_total numeric; v_limit numeric;
BEGIN
 IF NOT COALESCE(NEW.is_active,false) THEN RETURN NEW; END IF;
 SELECT term_id INTO v_term FROM public.course_offerings WHERE id=NEW.course_offering_id;
 IF public.existing_schedule_intake_enabled(NEW.college_id, v_term) THEN RETURN NEW; END IF;
 SELECT max_weekly_hours,administrative_release_hours,academic_rank
 INTO v_base,v_release,v_rank FROM public.instructors
 WHERE id=NEW.instructor_id AND college_id=NEW.college_id FOR UPDATE;
 IF v_base IS NULL THEN
  SELECT required_load_hours INTO v_base FROM public.faculty_workload_policies
  WHERE college_id=NEW.college_id AND active
   AND (lower(rank_code)=lower(COALESCE(v_rank,'')) OR EXISTS(
    SELECT 1 FROM unnest(rank_aliases) a WHERE lower(a)=lower(COALESCE(v_rank,''))))
  ORDER BY rank_code LIMIT 1;
 END IF;
 IF v_base IS NULL THEN
  RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب تحديد النصاب الأساسي للمحاضر قبل الإسناد' USING ERRCODE='23514';
 END IF;
 v_limit:=GREATEST(0,v_base-COALESCE(v_release,0))+12;
 SELECT COALESCE(SUM(CASE
   WHEN p.component_type='summer_training' OR COALESCE(d.excluded_from_standard_workload,false)
     OR p.counts_toward_regular_load=false THEN 0
   WHEN t.delivery_group_id IS NULL THEN COALESCE(t.assigned_component_hours,t.weekly_hours,0)
   WHEN (SELECT count(*) FROM public.teaching_assignments peer
         WHERE peer.delivery_group_id=t.delivery_group_id AND peer.is_active)>1
     THEN COALESCE(t.assigned_component_hours,0)
   ELSE COALESCE(t.assigned_component_hours,p.weekly_contact_hours,0)
 END),0) INTO v_total
 FROM public.teaching_assignments t
 JOIN public.course_offerings o ON o.id=t.course_offering_id
 LEFT JOIN public.delivery_groups d ON d.id=t.delivery_group_id
 LEFT JOIN public.plan_course_components p ON p.id=COALESCE(t.plan_course_component_id,d.component_id)
 WHERE t.instructor_id=NEW.instructor_id AND t.college_id=NEW.college_id
 AND t.is_active AND o.term_id=v_term;
 IF v_total>v_limit THEN
  RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا'
    USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$function$;
