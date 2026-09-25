-- Stage ITCS-ISO-02g. The selected-version group catalogue excludes draft
-- additions from published V2 and gives reports the matching merged sizes.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION public.schedule_version_delivery_group_catalog(p_version uuid,p_cohorts uuid[])
RETURNS TABLE(id uuid,cohort_id uuid,plan_course_id uuid,component_id uuid,
  group_code text,group_number integer,expected_students integer,
  capacity_limit integer,active boolean,is_obsolete boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','schedule_version_delivery_private' AS $body$
DECLARE v_college uuid; v_term uuid;
BEGIN
  IF p_cohorts IS NULL OR cardinality(p_cohorts)>100 THEN
    RAISE EXCEPTION 'VERSION_CATALOG_INVALID_BATCH' USING ERRCODE='23514';
  END IF;
  SELECT v.college_id,v.academic_term_id INTO v_college,v_term
  FROM public.schedule_versions v WHERE v.id=p_version;
  IF v_college IS NULL OR auth.uid() IS NULL
     OR NOT public.can_view_college(auth.uid(),v_college)
     OR EXISTS (SELECT 1 FROM unnest(p_cohorts) requested(cohort_id)
       LEFT JOIN public.academic_cohorts c ON c.id=requested.cohort_id
       WHERE c.id IS NULL OR c.college_id IS DISTINCT FROM v_college
         OR c.term_id IS DISTINCT FROM v_term) THEN
    RAISE EXCEPTION 'VERSION_CATALOG_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT actual.id,actual.cohort_id,actual.plan_course_id,actual.component_id,
    actual.group_code,actual.group_number,actual.expected_students,
    actual.capacity_limit,actual.active,actual.is_obsolete
  FROM public.delivery_groups g
  JOIN public.academic_cohorts c ON c.id=g.cohort_id AND c.college_id=v_college
    AND c.term_id=v_term
  CROSS JOIN LATERAL public.operational_delivery_group(p_version,g.id) actual
  WHERE g.college_id=v_college
    AND (g.cohort_id=ANY(p_cohorts) OR EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.shared_link_facts link
      JOIN public.delivery_groups m ON m.id=link.member_group_id
      WHERE link.version_id=p_version AND link.anchor_group_id=g.id
        AND m.cohort_id=ANY(p_cohorts)) OR EXISTS (
      SELECT 1 FROM public.shared_lecture_links link
      JOIN public.delivery_groups m ON m.id=link.member_group_id
      WHERE link.anchor_group_id=g.id AND m.cohort_id=ANY(p_cohorts)
        AND NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope scope
          WHERE scope.version_id=p_version AND scope.cohort_id=m.cohort_id)))
    AND (NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope scope
      WHERE scope.version_id=p_version AND scope.cohort_id=g.cohort_id)
      OR EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts fact
        WHERE fact.version_id=p_version AND fact.group_id=g.id));
END;
$body$;
REVOKE ALL ON FUNCTION public.schedule_version_delivery_group_catalog(uuid,uuid[])
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_version_delivery_group_catalog(uuid,uuid[])
  TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
