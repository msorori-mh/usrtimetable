-- Expanding a composite-returning function directly in a view calls the function
-- separately for each selected/filter/join column. Compute it once per visible
-- source row instead. Keep caller RLS, the composite type and all existing grants.
CREATE OR REPLACE VIEW public.operational_delivery_groups
WITH (security_invoker=true) AS
WITH group_records AS MATERIALIZED (
  SELECT public.operational_delivery_group(g.id) AS item
  FROM public.delivery_groups g
)
SELECT (item).* FROM group_records;
