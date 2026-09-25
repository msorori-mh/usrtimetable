\set ON_ERROR_STOP on
\ir itcs-v2-delivery-baseline-db.sql

-- Expand the disposable baseline with only the metadata needed by the
-- production version-scoped freshness, assignment and session guards.
ALTER TABLE public.academic_cohorts ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.delivery_groups ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.delivery_groups ADD COLUMN is_obsolete boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_groups ADD COLUMN component_id uuid;
ALTER TABLE public.delivery_groups ADD COLUMN group_number integer NOT NULL DEFAULT 1;
UPDATE public.delivery_groups SET component_id=cohort_id;
ALTER TABLE public.teaching_assignments ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.teaching_assignments ADD COLUMN plan_course_component_id uuid;
ALTER TABLE public.teaching_assignments ADD COLUMN required_room_type text;
UPDATE public.teaching_assignments SET plan_course_component_id=cohort_id;
CREATE TABLE public.room_types(
  id uuid PRIMARY KEY, college_id uuid NOT NULL, code text NOT NULL,
  default_capacity integer NOT NULL, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.room_types VALUES (
  'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  '7168345f-cf9d-4789-b2ad-547abb687dc8','lecture_room',200,true
);
CREATE TABLE public.plan_course_components(
  id uuid PRIMARY KEY, required_room_type_id uuid, explicit_group_size integer,
  component_type text NOT NULL, counts_toward_regular_load boolean NOT NULL DEFAULT true
);
INSERT INTO public.plan_course_components(id,required_room_type_id,component_type)
SELECT id,'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','theory'
FROM public.academic_cohorts;
CREATE FUNCTION public.effective_room_type_capacity(uuid,uuid)
RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 200 $$;
CREATE FUNCTION public.delivery_group_derivation_status(uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"ok":true,"code":"GLOBAL"}'::jsonb $$;

\ir ../docs/migrations-proposed/20260925_itcs_version_scoped_guards.sql

DO $assert$
DECLARE old_version uuid:='30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  draft uuid:='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
  anchor uuid; source_assignment uuid; s jsonb;
BEGIN
  SELECT id INTO anchor FROM public.delivery_groups
  WHERE cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e' AND group_code='G1';
  SELECT id INTO source_assignment FROM public.teaching_assignments
  WHERE delivery_group_id=anchor;
  s:=public.delivery_group_derivation_status(anchor,old_version);
  IF NOT coalesce((s->>'ok')::boolean,false) OR (s->>'headcount')::integer<>110 THEN
    RAISE EXCEPTION 'published freshness lost the 110-student source: %',s;
  END IF;
  s:=public.delivery_group_derivation_status(anchor,draft);
  IF NOT coalesce((s->>'ok')::boolean,false) OR (s->>'headcount')::integer<>140 THEN
    RAISE EXCEPTION 'draft freshness lost the 140-student source: %',s;
  END IF;
  IF (public.operational_delivery_group(old_version,anchor)).expected_students<>175
     OR (public.operational_delivery_group(draft,anchor)).expected_students<>207 THEN
    RAISE EXCEPTION 'shared anchor ignored version-scoped sizes';
  END IF;
  IF NOT (public._sb_v2_assignment_guard(source_assignment,old_version)->>'ok')::boolean
     OR NOT (public._sb_v2_assignment_guard(source_assignment,draft)->>'ok')::boolean THEN
    RAISE EXCEPTION 'existing lecturer assignment must work in both versions';
  END IF;
  IF coalesce((public.delivery_group_derivation_status(
    '00000000-0000-0000-0000-000000000099',old_version)->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'draft-only group was accepted in published V2';
  END IF;
  UPDATE public.delivery_groups SET expected_students=999 WHERE id=anchor;
  IF NOT public.delivery_group_is_current(anchor,old_version)
     OR NOT public.delivery_group_is_current(anchor,draft)
     OR (public.operational_delivery_group(old_version,anchor)).expected_students<>175 THEN
    RAISE EXCEPTION 'global size leaked into version-scoped guard';
  END IF;
END;
$assert$;

CREATE TRIGGER trg_schedule_session_current_delivery_group
BEFORE INSERT OR UPDATE ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_session_current_delivery_group();

DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.schedule_sessions(id,schedule_version_id,cohort_id,
      course_offering_id,delivery_group_id)
    SELECT gen_random_uuid(),'30f8a76d-1cb9-4944-a5d7-483dcaea7692',
      g.cohort_id,(SELECT id FROM public.course_offerings LIMIT 1),g.id
    FROM public.delivery_groups g
    WHERE g.id='00000000-0000-0000-0000-000000000099';
    RAISE EXCEPTION 'published session accepted a draft-only group';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.schedule_sessions(id,schedule_version_id,cohort_id,
    course_offering_id,delivery_group_id)
  SELECT gen_random_uuid(),'30f8a76d-1cb9-4944-a5d7-483dcaea7692',
    g.cohort_id,(SELECT id FROM public.course_offerings LIMIT 1),g.id
  FROM public.delivery_groups g
  WHERE g.cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e'
    AND g.group_code='G1';
END;
$assert$;

SET ROLE authenticated;
SET request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
DO $assert$
BEGIN
  IF coalesce((public.delivery_group_derivation_status(
    (SELECT id FROM public.delivery_groups
     WHERE cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e' LIMIT 1),
    '30f8a76d-1cb9-4944-a5d7-483dcaea7692')->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'outside college passed versioned guard';
  END IF;
END;
$assert$;
RESET ROLE;
