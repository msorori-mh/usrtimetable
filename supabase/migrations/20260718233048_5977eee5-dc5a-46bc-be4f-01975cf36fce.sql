-- Source-only migration. Do not apply to production without the production gate.
BEGIN;

ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS ij_status_check;
ALTER TABLE public.import_jobs
  ADD CONSTRAINT import_jobs_status_check
  CHECK (status IN ('preview', 'committing', 'committed', 'failed', 'cancelled'));

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS validated_payload jsonb,
  ADD COLUMN IF NOT EXISTS payload_manifest text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_message text;

CREATE OR REPLACE FUNCTION public.import_manager_actor(p_college_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'college import access denied' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_import_preview_manifest(
  p_college_id uuid,
  p_target_entity text,
  p_mode text,
  p_file_name text,
  p_total_rows integer,
  p_validated_payload jsonb,
  p_errors jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.import_manager_actor(p_college_id);
  v_job_id uuid;
  v_valid integer;
  v_manifest text;
BEGIN
  IF jsonb_typeof(p_validated_payload) <> 'array' OR jsonb_typeof(p_errors) <> 'array' THEN
    RAISE EXCEPTION 'payload and errors must be arrays' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('insert_only', 'update_existing', 'upsert') OR coalesce(p_target_entity, '') = '' THEN
    RAISE EXCEPTION 'invalid import contract' USING ERRCODE = '22023';
  END IF;
  v_valid := jsonb_array_length(p_validated_payload);
  IF p_total_rows < v_valid OR p_total_rows < 0 THEN
    RAISE EXCEPTION 'invalid row counts' USING ERRCODE = '22023';
  END IF;
  v_manifest := md5(p_validated_payload::text);

  INSERT INTO public.import_jobs (
    college_id, target_entity, mode, status, file_name, total_rows, valid_rows,
    invalid_rows, created_by, validated_payload, payload_manifest
  ) VALUES (
    p_college_id, p_target_entity, p_mode, 'preview', p_file_name, p_total_rows,
    v_valid, p_total_rows - v_valid, v_actor, p_validated_payload, v_manifest
  ) RETURNING id INTO v_job_id;

  INSERT INTO public.import_errors (
    college_id, job_id, row_number, column_name, error_code, message, raw_value
  )
  SELECT p_college_id, v_job_id, coalesce((e->>'rowNumber')::integer, 0),
    e->>'columnName', coalesce(e->>'errorCode', 'validation_error'),
    coalesce(e->>'message', 'Validation failed'), e->>'rawValue'
  FROM jsonb_array_elements(p_errors) AS e;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, 'import_preview', 'import_' || p_target_entity, v_job_id, p_college_id,
    jsonb_build_object('mode', p_mode, 'manifest', v_manifest, 'total', p_total_rows,
      'valid', v_valid, 'invalid', p_total_rows - v_valid));
  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_import_job_manifest(
  p_job_id uuid,
  p_college_id uuid,
  p_target_entity text,
  p_mode text,
  p_validated_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.import_manager_actor(p_college_id);
  v_job public.import_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs
  WHERE id = p_job_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND OR v_job.created_by <> v_actor OR v_job.target_entity <> p_target_entity
     OR v_job.mode <> p_mode OR v_job.status <> 'preview' THEN
    RAISE EXCEPTION 'import job is not claimable' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_validated_payload) <> 'array'
     OR v_job.validated_payload IS DISTINCT FROM p_validated_payload
     OR v_job.payload_manifest IS DISTINCT FROM md5(p_validated_payload::text) THEN
    RAISE EXCEPTION 'import payload manifest mismatch' USING ERRCODE = '23000';
  END IF;

  UPDATE public.import_jobs SET status = 'committing', claimed_at = now()
  WHERE id = p_job_id AND status = 'preview';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import job claim lost' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, 'import_claim', 'import_' || p_target_entity, p_job_id, p_college_id,
    jsonb_build_object('mode', p_mode, 'manifest', v_job.payload_manifest));
  RETURN jsonb_build_object('validated_payload', v_job.validated_payload,
    'payload_manifest', v_job.payload_manifest);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_import_job(
  p_job_id uuid,
  p_college_id uuid,
  p_inserted_rows integer,
  p_updated_rows integer,
  p_skipped_rows integer,
  p_failed_rows integer,
  p_errors jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.import_manager_actor(p_college_id);
  v_job public.import_jobs%ROWTYPE;
  v_status text;
BEGIN
  IF least(p_inserted_rows, p_updated_rows, p_skipped_rows, p_failed_rows) < 0
     OR jsonb_typeof(p_errors) <> 'array' THEN
    RAISE EXCEPTION 'invalid finalization payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.import_jobs
  WHERE id = p_job_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND OR v_job.created_by <> v_actor OR v_job.status <> 'committing' THEN
    RAISE EXCEPTION 'import job is not finalizable' USING ERRCODE = '55000';
  END IF;
  v_status := CASE WHEN p_failed_rows > 0 THEN 'failed' ELSE 'committed' END;
  UPDATE public.import_jobs SET status = v_status, inserted_rows = p_inserted_rows,
    updated_rows = p_updated_rows, skipped_rows = p_skipped_rows,
    failure_message = CASE WHEN p_failed_rows > 0 THEN 'One or more rows failed' END,
    finished_at = now()
  WHERE id = p_job_id AND status = 'committing';
  IF NOT FOUND THEN RAISE EXCEPTION 'import finalization lost' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.import_errors (
    college_id, job_id, row_number, column_name, error_code, message, raw_value
  ) SELECT p_college_id, p_job_id, coalesce((e->>'rowNumber')::integer, 0),
    e->>'columnName', coalesce(e->>'errorCode', 'db_error'),
    coalesce(e->>'message', 'Import failed'), e->>'rawValue'
  FROM jsonb_array_elements(p_errors) AS e;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, CASE WHEN v_status = 'committed' THEN 'import_commit' ELSE 'import_failed' END,
    'import_' || v_job.target_entity, p_job_id, p_college_id,
    jsonb_build_object('mode', v_job.mode, 'manifest', v_job.payload_manifest,
      'inserted', p_inserted_rows, 'updated', p_updated_rows, 'skipped', p_skipped_rows,
      'failed', p_failed_rows));
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_import_job(
  p_job_id uuid, p_college_id uuid, p_message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.import_manager_actor(p_college_id);
  v_job public.import_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs
  WHERE id = p_job_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND OR v_job.created_by <> v_actor OR v_job.status <> 'committing' THEN
    RAISE EXCEPTION 'import job is not recoverable' USING ERRCODE = '55000';
  END IF;
  UPDATE public.import_jobs SET status = 'failed', failure_message = left(p_message, 2000),
    finished_at = now() WHERE id = p_job_id AND status = 'committing';
  IF NOT FOUND THEN RAISE EXCEPTION 'import recovery lost' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, 'import_failed', 'import_' || v_job.target_entity, p_job_id, p_college_id,
    jsonb_build_object('mode', v_job.mode, 'manifest', v_job.payload_manifest,
      'message', left(p_message, 2000)));
END;
$$;

REVOKE ALL ON FUNCTION public.import_manager_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_import_preview_manifest(uuid,text,text,text,integer,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_import_job_manifest(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_import_job(uuid,uuid,integer,integer,integer,integer,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fail_import_job(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_import_preview_manifest(uuid,text,text,text,integer,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_import_job_manifest(uuid,uuid,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_import_job(uuid,uuid,integer,integer,integer,integer,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_import_job(uuid,uuid,text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.import_jobs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.import_errors FROM authenticated;

COMMIT;