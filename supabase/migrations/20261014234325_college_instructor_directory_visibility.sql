BEGIN;
-- A college can stop listing a former lecturer without changing their home
-- affiliation, active status, assignments, or historical timetable rows.
CREATE TABLE IF NOT EXISTS faculty_private.college_directory_visibility (
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  identity_id uuid NOT NULL REFERENCES public.faculty_identities(id),
  is_visible boolean NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (college_id, identity_id)
);
ALTER TABLE faculty_private.college_directory_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON faculty_private.college_directory_visibility FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_college_instructor_directory_visibility(
  p_college_id uuid, p_instructor_id uuid, p_is_visible boolean, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE actor uuid := auth.uid(); identity uuid; university uuid;
BEGIN
  IF actor IS NULL OR p_college_id IS NULL
     OR NOT public.can_manage_college(actor, p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_is_visible IS NULL OR length(btrim(coalesce(p_reason,''))) < 8 THEN
    RAISE EXCEPTION 'DIRECTORY_VISIBILITY_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT l.identity_id, h.university_id INTO identity, university
  FROM public.faculty_identity_links l
  JOIN faculty_private.home_profiles h ON h.identity_id=l.identity_id
  WHERE l.instructor_id=p_instructor_id;
  IF identity IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.colleges c WHERE c.id=p_college_id AND c.university_id=university
  ) THEN RAISE EXCEPTION 'DIRECTORY_INSTRUCTOR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- A supplied UUID must already belong to this college's directory, or have
  -- a visibility record here that this manager is restoring.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.get_college_instructor_schedule_directory(p_college_id)) r
    WHERE (r->>'identity_id')::uuid=identity
  ) AND NOT EXISTS (
    SELECT 1 FROM faculty_private.college_directory_visibility v
    WHERE v.college_id=p_college_id AND v.identity_id=identity
  ) THEN RAISE EXCEPTION 'DIRECTORY_INSTRUCTOR_NOT_IN_COLLEGE' USING ERRCODE = '42501'; END IF;

  INSERT INTO faculty_private.college_directory_visibility
    (college_id,identity_id,is_visible,reason,updated_by)
  VALUES(p_college_id,identity,p_is_visible,btrim(p_reason),actor)
  ON CONFLICT(college_id,identity_id) DO UPDATE SET
    is_visible=excluded.is_visible,reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=clock_timestamp();
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES(actor,'set_college_instructor_directory_visibility','faculty_identities',identity,p_college_id,
    jsonb_build_object('is_visible',p_is_visible,'reason',btrim(p_reason)));
  RETURN jsonb_build_object('ok',true,'identity_id',identity,'college_id',p_college_id,'is_visible',p_is_visible);
END $function$;
REVOKE ALL ON FUNCTION public.set_college_instructor_directory_visibility(uuid,uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_college_instructor_directory_visibility(uuid,uuid,boolean,text) TO authenticated;

DO $patch$
DECLARE d text; before_text text := $old$ WHERE h.university_id = v_university AND h.full_name !~* 'TEST_ONLY'$old$;
 after_text text := $new$ WHERE h.university_id = v_university AND h.full_name !~* 'TEST_ONLY'
  AND NOT EXISTS (
    SELECT 1 FROM faculty_private.college_directory_visibility visibility
    WHERE visibility.college_id=p_college_id AND visibility.identity_id=h.identity_id
      AND NOT visibility.is_visible
  )$new$;
BEGIN
  d:=pg_get_functiondef('public.get_college_instructor_schedule_directory(uuid)'::regprocedure);
  IF position('faculty_private.college_directory_visibility' IN d)>0 THEN RETURN; END IF;
  IF (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 THEN
    RAISE EXCEPTION 'COLLEGE_DIRECTORY_DEFINITION_DRIFT';
  END IF;
  EXECUTE replace(d,before_text,after_text);
END $patch$;
-- Recovery: call set_college_instructor_directory_visibility with true for the
-- same college and identity's instructor. No history needs to be rewritten.
COMMIT;
