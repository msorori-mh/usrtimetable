BEGIN;
-- A legally approved hosted lecturer retains one canonical instructor record.
-- Availability stored on that record's source college must be considered by
-- the host's validator, including hard-unavailable windows. No availability
-- window is invented and no conflict is approved by this read-model repair.
CREATE OR REPLACE FUNCTION public.approved_instructor_availability_colleges(
  p_college_id uuid, p_instructor_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT array_agg(DISTINCT allowed.college_id)
  FROM (
    SELECT p_college_id AS college_id
    UNION
    SELECT i.college_id
    FROM public.instructors i
    JOIN public.faculty_identity_links link ON link.instructor_id=i.id
    JOIN faculty_private.home_profiles home ON home.identity_id=link.identity_id
    WHERE i.id=p_instructor_id AND i.is_active
      AND home.is_active AND home.affiliation_status='verified'
      AND home.source_instructor_id=i.id
      AND EXISTS (
        SELECT 1 FROM public.faculty_teaching_requests request
        WHERE request.identity_id=home.identity_id
          AND request.instructor_id=i.id
          AND request.home_college_id=home.home_college_id
          AND request.college_id=p_college_id
          AND request.status='approved'
          AND request.decided_by IS NOT NULL AND request.decided_at IS NOT NULL
      )
  ) allowed
  WHERE auth.uid() IS NULL OR public.can_view_college(auth.uid(),p_college_id)
$function$;
REVOKE ALL ON FUNCTION public.approved_instructor_availability_colleges(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approved_instructor_availability_colleges(uuid,uuid) TO authenticated,service_role;
DO $patch$
DECLARE signature text; definition text; expected integer;
  before_text text := 'ia.college_id = p_cid';
  after_text text := 'ia.college_id = ANY(public.approved_instructor_availability_colleges(p_cid, p_iid))';
BEGIN
  FOR signature,expected IN SELECT * FROM (VALUES
    ('public._ss_iavail_req(uuid,uuid,uuid,integer)',1),
    ('public._ss_iavail_win(uuid,uuid,uuid,integer,time,time)',2)
  ) patches(signature,expected) LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    CONTINUE WHEN position('approved_instructor_availability_colleges' IN definition)>0;
    IF (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>expected THEN
      RAISE EXCEPTION 'EXTERNAL_AVAILABILITY_DEFINITION_DRIFT: %',signature;
    END IF;
    EXECUTE replace(definition,before_text,after_text);
  END LOOP;
END $patch$;
COMMIT;
