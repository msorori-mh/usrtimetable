-- A dean may read the university-wide teaching load of faculty assigned to
-- their college as home college, even when the source instructor card was
-- originally created in another college. Cross-college details stay redacted.
CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(
  p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.instructors i
   WHERE i.id = p_instructor_id AND (
     public.can_view_college(auth.uid(), i.college_id)
     OR EXISTS (
       SELECT 1 FROM public.faculty_identity_links l
       JOIN faculty_private.home_profiles h ON h.identity_id = l.identity_id
       WHERE l.instructor_id = i.id AND h.home_college_id IS NOT NULL
         AND public.can_view_college(auth.uid(), h.home_college_id)
     )
   )
 ) THEN
   RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
 END IF;

 v := faculty_private.workload(p_instructor_id, p_term_id);
 -- College managers receive aggregate hours, never the other colleges' details.
 IF NOT (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'university_leadership')) THEN
   v := v || jsonb_build_object('hours_by_college', '[]'::jsonb);
 END IF;
 RETURN v;
END
$function$;
