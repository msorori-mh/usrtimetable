-- STAGE-03I-B: canonical Teaching Assignments V2 duplicate contract.
-- SOURCE ONLY. Do not apply automatically.

BEGIN;

CREATE OR REPLACE FUNCTION public._import_apply_teaching_assignments_v2(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_payload jsonb;
  v_canonical_payload jsonb;
  v_res jsonb;
  v_conflict_key text;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_delivery_group_id', '') IS NULL
       OR NULLIF(v->>'_instructor_id', '') IS NULL THEN
      RAISE EXCEPTION 'teaching_assignments_v2 row % missing delivery_group/instructor', v_rn
        USING ERRCODE = '22023';
    END IF;
    IF v->>'component_type' = 'summer_training' THEN
      RAISE EXCEPTION
        'teaching_assignments_v2 row %: summer training cannot be assigned as weekly teaching', v_rn
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'row_number', public._import_row_number(p_rows -> ord, ord + 1),
      'delivery_group_id', vv->>'_delivery_group_id',
      'instructor_id', vv->>'_instructor_id',
      'assigned_component_hours',
        CASE
          WHEN NULLIF(vv->>'_assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'_assigned_component_hours')::numeric
          WHEN NULLIF(vv->>'assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'assigned_component_hours')::numeric
          ELSE NULL
        END,
      'notes', NULLIF(vv->>'notes', ''),
      'is_active', COALESCE(NULLIF(vv->>'_is_active', '')::boolean, true),
      'course_offering_id', NULLIF(vv->>'_offering_id', ''),
      'expected_students', COALESCE(NULLIF(vv->>'expected_students', '')::int, 0),
      'required_room_type', NULLIF(vv->>'required_room_type', ''),
      'session_type', CASE vv->>'component_type'
        WHEN 'theory' THEN 'lecture'
        WHEN 'practical' THEN 'lab'
        WHEN 'tutorial' THEN 'tutorial'
        WHEN 'project' THEN 'seminar'
        WHEN 'summer_training' THEN 'seminar'
        ELSE 'lecture'
      END
    ) ORDER BY ord
  ), '[]'::jsonb)
  INTO v_payload
  FROM generate_series(0, GREATEST(v_len - 1, -1)) AS ord
  CROSS JOIN LATERAL (SELECT public._import_row_values(p_rows -> ord) AS vv) AS lat;

  -- The active database uniqueness contract proves this natural key:
  -- college_id + delivery_group_id + instructor_id. p_college supplies the
  -- college scope, so the batch key is delivery_group_id + instructor_id.
  -- Any differing operational payload for that key is a conflict. It must not
  -- be resolved by input order.
  SELECT natural_key
  INTO v_conflict_key
  FROM (
    SELECT
      e->>'delivery_group_id' || '|' || e->>'instructor_id' AS natural_key,
      COUNT(DISTINCT (e - 'row_number')::text) AS variants
    FROM jsonb_array_elements(v_payload) e
    GROUP BY e->>'delivery_group_id', e->>'instructor_id'
    HAVING COUNT(DISTINCT (e - 'row_number')::text) > 1
  ) conflicts
  ORDER BY natural_key
  LIMIT 1;

  IF v_conflict_key IS NOT NULL THEN
    RAISE EXCEPTION 'TEACHING_ASSIGNMENT_V2_DUPLICATE_CONFLICT: %', v_conflict_key
      USING ERRCODE = '22023';
  END IF;

  -- Collapse byte-identical operations deterministically. Source provenance
  -- remains in import_jobs.validated_payload; it is not discarded from audit.
  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'row_number')::int), '[]'::jsonb)
  INTO v_canonical_payload
  FROM (
    SELECT DISTINCT ON (e->>'delivery_group_id', e->>'instructor_id') e
    FROM jsonb_array_elements(v_payload) e
    ORDER BY
      e->>'delivery_group_id',
      e->>'instructor_id',
      (e->>'row_number')::int
  ) canonical;

  IF jsonb_array_length(v_canonical_payload) = 0 THEN
    RETURN public._import_counters_new();
  END IF;

  v_res := public.commit_teaching_assignments_v2_import(v_canonical_payload, p_mode);
  IF COALESCE(v_res->>'status', '') <> 'ok' THEN
    RAISE EXCEPTION 'teaching_assignments_v2 import failed: %',
      COALESCE(v_res->'validation_errors', '[]'::jsonb)::text
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inserted',
      COALESCE((v_res->>'rows_created')::int, 0)
      + COALESCE((v_res->>'rows_reactivated')::int, 0),
    'updated', COALESCE((v_res->>'rows_updated')::int, 0),
    'skipped', COALESCE((v_res->>'rows_unchanged')::int, 0)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._import_apply_teaching_assignments_v2(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- Prevent authenticated clients bypassing the canonical import-job handler.
-- The SECURITY DEFINER handler above executes as its owner; service_role is
-- retained for controlled administration.
REVOKE EXECUTE ON FUNCTION public.commit_teaching_assignments_v2_import(jsonb, text)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_teaching_assignments_v2_import(jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public._import_apply_teaching_assignments_v2(uuid, text, jsonb) IS
  'Canonical V2 import: identical natural-key duplicates collapse; conflicting duplicates fail closed; source provenance remains in import_jobs.validated_payload.';

COMMIT;
