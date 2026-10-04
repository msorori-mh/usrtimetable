CREATE OR REPLACE FUNCTION public.academic_program_owners(p_program_ids uuid[])
RETURNS TABLE (program_id uuid, owner_program_id uuid, program_name text, college_id uuid, college_name text, department_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE asked AS (
    SELECT p.id FROM public.academic_programs p
    WHERE p.id = ANY (p_program_ids)
      AND auth.uid() IS NOT NULL
      AND NOT public.password_change_required()
      AND NOT public.security_mfa_required()
      AND public.can_view_college(auth.uid(), p.college_id)
  ), chain AS (
    SELECT a.id AS asked_id, p.id, p.canonical_program_id, 0 AS depth, ARRAY[p.id] AS path
    FROM asked a JOIN public.academic_programs p ON p.id = a.id
    UNION ALL
    SELECT c.asked_id, p.id, p.canonical_program_id, c.depth + 1, c.path || p.id
    FROM chain c JOIN public.academic_programs p ON p.id = c.canonical_program_id
    WHERE c.depth < 32 AND NOT p.id = ANY (c.path)
  )
  SELECT c.asked_id, o.id, o.name, col.id, col.name, COALESCE(d.name, '')
  FROM chain c
  JOIN public.academic_programs o ON o.id = c.id
  JOIN public.colleges col ON col.id = o.college_id
  LEFT JOIN public.departments d ON d.id = o.department_id
  WHERE c.canonical_program_id IS NULL
$function$;
REVOKE ALL ON FUNCTION public.academic_program_owners(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academic_program_owners(uuid[]) TO authenticated, service_role;