-- Set-based equivalent of per-row public.operational_delivery_group(): lets
-- college_id / active / is_obsolete filters push down to delivery_groups.
CREATE OR REPLACE VIEW public.operational_delivery_groups
WITH (security_invoker=true) AS
SELECT
  g.id,
  g.college_id,
  g.cohort_id,
  g.plan_course_id,
  g.component_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id = g.id) THEN g.group_code
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id = g.id)
      THEN g.group_code || ' — مدمج ضمن النظام نفسه'
    ELSE g.group_code
  END AS group_code,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id = g.id) THEN g.expected_students
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id = g.id)
      THEN (SELECT sum(d.expected_students)::integer
              FROM public.delivery_groups d
              JOIN public.shared_lecture_group_ids(g.id) m ON m.group_id = d.id)
    ELSE g.expected_students
  END AS expected_students,
  g.capacity_limit,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id = g.id) THEN false
    ELSE g.active
  END AS active,
  g.created_at,
  g.updated_at,
  g.group_number,
  g.excluded_from_standard_workload,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id = g.id) THEN true
    ELSE g.is_obsolete
  END AS is_obsolete
FROM public.delivery_groups g;

REVOKE ALL ON public.operational_delivery_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.operational_delivery_groups TO authenticated;
GRANT SELECT ON public.operational_delivery_groups TO service_role;

CREATE INDEX IF NOT EXISTS idx_ie_job_row ON public.import_errors (job_id, row_number);

NOTIFY pgrst, 'reload schema';