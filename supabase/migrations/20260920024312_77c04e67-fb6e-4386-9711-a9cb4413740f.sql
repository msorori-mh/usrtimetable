CREATE OR REPLACE VIEW public.operational_delivery_groups
WITH (security_invoker = true) AS
SELECT
  g.id AS id,
  g.college_id AS college_id,
  g.cohort_id AS cohort_id,
  g.plan_course_id AS plan_course_id,
  g.component_id AS component_id,
  (x.item).group_code AS group_code,
  (x.item).expected_students AS expected_students,
  g.capacity_limit AS capacity_limit,
  (x.item).active AS active,
  g.created_at AS created_at,
  g.updated_at AS updated_at,
  g.group_number AS group_number,
  g.excluded_from_standard_workload AS excluded_from_standard_workload,
  (x.item).is_obsolete AS is_obsolete
FROM public.delivery_groups g
CROSS JOIN LATERAL (SELECT public.operational_delivery_group(g.id) AS item) x;