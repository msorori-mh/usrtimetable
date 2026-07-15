CREATE OR REPLACE FUNCTION public._ss_sg(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT section_subgroup_id FROM public.schedule_sessions WHERE id=p_id;
$$;
REVOKE ALL ON FUNCTION public._ss_sg(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_sg(uuid) TO service_role;
