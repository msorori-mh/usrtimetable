-- Expanding a composite-returning plpgsql function in a view runs it per source
-- row and blocks filter pushdown, so every read scanned all delivery groups and
-- hit the statement timeout. Express the same operational rules set-based so
-- college_id/active/is_obsolete filters reach public.delivery_groups directly.
-- Keep caller RLS (security_invoker), the column order and all existing grants.
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
              WHERE d.id = g.id
                 OR d.id IN (SELECT l.member_group_id FROM public.shared_lecture_links l
                              WHERE l.anchor_group_id = g.id))
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
