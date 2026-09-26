CREATE TABLE public.delivery_group_source_structures (
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id),
  component_id uuid NOT NULL REFERENCES public.plan_course_components(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  term_id uuid NOT NULL REFERENCES public.academic_terms(id),
  group_count integer NOT NULL CHECK (group_count BETWEEN 1 AND 20),
  reason text NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, component_id)
);
GRANT SELECT ON public.delivery_group_source_structures TO authenticated;
GRANT ALL ON public.delivery_group_source_structures TO service_role;
ALTER TABLE public.delivery_group_source_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View source group structure of visible colleges" ON public.delivery_group_source_structures
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));

DO $mig$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.delivery_group_derivation_status(uuid)'::regprocedure);
  n := replace(d, 'v_expected_groups:=CEIL(v_headcount::numeric/v_capacity::numeric)::integer;',
    'v_expected_groups:=COALESCE((SELECT s.group_count FROM public.delivery_group_source_structures s WHERE s.cohort_id=v_g.cohort_id AND s.component_id=v_g.component_id AND s.college_id=v_g.college_id AND s.term_id=v_ac.term_id),CEIL(v_headcount::numeric/v_capacity::numeric)::integer);');
  IF n = d THEN RAISE EXCEPTION 'PATCH_ANCHOR_MISSING_GLOBAL'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.delivery_group_derivation_status(uuid,uuid)'::regprocedure);
  n := replace(d, 'v_expected:=ceil(v_headcount::numeric/v_capacity::numeric)::integer;',
    'v_expected:=COALESCE((SELECT s.group_count FROM public.delivery_group_source_structures s WHERE s.cohort_id=g.cohort_id AND s.component_id=g.component_id AND s.college_id=g.college_id AND s.term_id=c.term_id),ceil(v_headcount::numeric/v_capacity::numeric)::integer);');
  IF n = d THEN RAISE EXCEPTION 'PATCH_ANCHOR_MISSING_VERSION'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.guard_shared_lecture_source()'::regprocedure);
  n := replace(d, E'BEGIN\n  IF TG_OP=''UPDATE'' AND NEW.college_id=''d78cf264',
    E'BEGIN\n  -- Imported-timetable completion: fill blank sizes once, only where an approved source structure exists.\n  IF TG_OP=''UPDATE'' AND OLD.expected_students IS NULL\n  AND NEW.expected_students IS NOT NULL AND NEW.expected_students>0 AND NEW.capacity_limit IS NOT NULL AND NEW.expected_students<=NEW.capacity_limit\n  AND (to_jsonb(NEW)-''expected_students''-''capacity_limit''-''group_number''-''updated_at'')=(to_jsonb(OLD)-''expected_students''-''capacity_limit''-''group_number''-''updated_at'')\n  AND EXISTS(SELECT 1 FROM public.delivery_group_source_structures s WHERE s.cohort_id=NEW.cohort_id AND s.component_id=NEW.component_id AND s.college_id=NEW.college_id)\n  THEN RETURN NEW; END IF;\n  IF TG_OP=''UPDATE'' AND NEW.college_id=''d78cf264');
  IF n = d THEN RAISE EXCEPTION 'PATCH_ANCHOR_MISSING_GUARD'; END IF;
  EXECUTE n;
END $mig$;
NOTIFY pgrst, 'reload schema';