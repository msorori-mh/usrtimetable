-- Retire obsolete plans without cascading into timetables or cohorts.
BEGIN;

ALTER TABLE public.study_plans
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE OR REPLACE FUNCTION public.guard_archived_study_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'PLAN_ARCHIVE_RPC_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.archived_at IS NOT NULL AND
     (NEW.name, NEW.code, NEW.version, NEW.program_id, NEW.effective_year,
      NEW.is_active, NEW.archived_at, NEW.archived_by) IS DISTINCT FROM
     (OLD.name, OLD.code, OLD.version, OLD.program_id, OLD.effective_year,
      OLD.is_active, OLD.archived_at, OLD.archived_by) THEN
    RAISE EXCEPTION 'ARCHIVED_PLAN_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.archived_at IS NOT NULL AND NEW.is_active THEN
    RAISE EXCEPTION 'ARCHIVED_PLAN_MUST_BE_INACTIVE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_archived_study_plan ON public.study_plans;
CREATE TRIGGER trg_guard_archived_study_plan
  BEFORE INSERT OR UPDATE ON public.study_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_study_plan();

CREATE TABLE IF NOT EXISTS public.deleted_study_plan_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_plan_id uuid NOT NULL UNIQUE,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  archived_at timestamptz NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid NOT NULL,
  payload jsonb NOT NULL
);
REVOKE ALL ON public.deleted_study_plan_archives FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.study_plan_delete_readiness(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  p public.study_plans%ROWTYPE;
  v_cohorts integer;
  v_offerings integer;
  v_groups integer;
  v_selections integer;
  v_sources integer;
BEGIN
  SELECT * INTO p FROM public.study_plans WHERE id = p_plan_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p.college_id) THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_cohorts FROM public.academic_cohorts WHERE study_plan_id = p.id;
  SELECT count(*) INTO v_offerings FROM public.course_offerings
    WHERE study_plan_id = p.id OR plan_course_id IN
      (SELECT id FROM public.plan_courses WHERE study_plan_id = p.id);
  SELECT count(*) INTO v_groups FROM public.delivery_groups WHERE plan_course_id IN
    (SELECT id FROM public.plan_courses WHERE study_plan_id = p.id);
  SELECT count(*) INTO v_selections FROM public.cohort_elective_selections
    WHERE elective_slot_id IN (SELECT id FROM public.elective_slots WHERE study_plan_id = p.id);
  SELECT count(*) INTO v_sources FROM public.existing_schedule_source_rows
    WHERE study_plan_id = p.id OR plan_course_id IN
      (SELECT id FROM public.plan_courses WHERE study_plan_id = p.id)
      OR component_id IN (
        SELECT c.id FROM public.plan_course_components c
        JOIN public.plan_courses pc ON pc.id = c.plan_course_id WHERE pc.study_plan_id = p.id
      );
  RETURN jsonb_build_object(
    'plan_id', p.id, 'archived', p.archived_at IS NOT NULL,
    'active', p.is_active,
    'can_delete', p.archived_at IS NOT NULL AND NOT p.is_active
      AND v_cohorts = 0 AND v_offerings = 0 AND v_groups = 0
      AND v_selections = 0 AND v_sources = 0,
    'cohorts', v_cohorts, 'offerings', v_offerings, 'groups', v_groups,
    'elective_selections', v_selections, 'source_rows', v_sources);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_study_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE p public.study_plans%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.study_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p.college_id) THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p.is_active THEN
    RAISE EXCEPTION 'PLAN_DEACTIVATE_BEFORE_ARCHIVE' USING ERRCODE = '23514';
  END IF;
  UPDATE public.study_plans
    SET archived_at = coalesce(archived_at, now()),
        archived_by = coalesce(archived_by, auth.uid())
    WHERE id = p.id;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
    VALUES(auth.uid(), 'archive', 'study_plans', p.id, p.college_id,
           jsonb_build_object('code', p.code, 'version', p.version));
  RETURN public.study_plan_delete_readiness(p.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_archived_study_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  p public.study_plans%ROWTYPE;
  r jsonb;
  v_deleted integer;
BEGIN
  -- Serialize with curriculum generation and other plan writers.
  PERFORM pg_advisory_xact_lock(9262, 1);
  SELECT * INTO p FROM public.study_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p.college_id) THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  r := public.study_plan_delete_readiness(p.id);
  IF NOT (r->>'can_delete')::boolean THEN
    RAISE EXCEPTION 'PLAN_DELETE_BLOCKED:%', r USING ERRCODE = '23514';
  END IF;

  -- Retain the exact plan structure before removing the unused rows.
  INSERT INTO public.deleted_study_plan_archives
    (study_plan_id, college_id, archived_at, deleted_by, payload)
  SELECT p.id, p.college_id, p.archived_at, auth.uid(),
    jsonb_build_object(
      'plan', to_jsonb(p),
      'courses', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.plan_courses x
                            WHERE x.study_plan_id = p.id), '[]'::jsonb),
      'components', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.plan_course_components x
                     JOIN public.plan_courses pc ON pc.id = x.plan_course_id
                     WHERE pc.study_plan_id = p.id), '[]'::jsonb),
      'elective_slots', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.elective_slots x
                                 WHERE x.study_plan_id = p.id), '[]'::jsonb),
      'elective_courses', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.elective_slot_courses x
                    JOIN public.elective_slots s ON s.id = x.elective_slot_id
                    WHERE s.study_plan_id = p.id), '[]'::jsonb));

  DELETE FROM public.elective_slot_courses WHERE elective_slot_id IN
    (SELECT id FROM public.elective_slots WHERE study_plan_id = p.id);
  DELETE FROM public.elective_slots WHERE study_plan_id = p.id;
  DELETE FROM public.plan_course_components WHERE plan_course_id IN
    (SELECT id FROM public.plan_courses WHERE study_plan_id = p.id);
  DELETE FROM public.plan_courses WHERE study_plan_id = p.id;
  DELETE FROM public.study_plans WHERE id = p.id AND archived_at IS NOT NULL AND NOT is_active;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'PLAN_DELETE_STALE' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
    VALUES(auth.uid(), 'delete_archived', 'study_plans', p.id, p.college_id, r);
  RETURN jsonb_build_object('deleted', true, 'plan_id', p.id);
END;
$$;

REVOKE ALL ON FUNCTION public.study_plan_delete_readiness(uuid),
  public.archive_study_plan(uuid), public.delete_archived_study_plan(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.study_plan_delete_readiness(uuid),
  public.archive_study_plan(uuid), public.delete_archived_study_plan(uuid)
  TO authenticated;

-- No client may toggle the archive marker or bypass the guarded delete RPC.
REVOKE DELETE ON public.study_plans FROM authenticated;
REVOKE UPDATE ON public.study_plans FROM authenticated;
GRANT UPDATE (name, code, version, program_id, college_id, effective_year, is_active)
  ON public.study_plans TO authenticated;
DROP POLICY IF EXISTS sp_delete ON public.study_plans;

COMMIT;
