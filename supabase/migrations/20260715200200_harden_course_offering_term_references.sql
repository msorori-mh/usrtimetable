- PHASE-6: Harden course_offerings.term_id (SOURCE ONLY â€” do not auto-apply).
-- Adds NOT VALID FK so 213 legacy orphan term_ids do not block apply.
-- New/updated offerings cannot reference missing terms; ON DELETE RESTRICT.
-- Does NOT run VALIDATE on the FK. Does NOT modify legacy offering rows.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_course_offerings_term_id
  ON public.course_offerings (term_id);

DO $$
DECLARE
  v_fk_exists boolean;
  v_convalidated boolean;
  v_confdeltype char;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'course_offerings_term_id_fkey'
      AND conrelid = 'public.course_offerings'::regclass
  ) INTO v_fk_exists;

  IF v_fk_exists THEN
    SELECT c.convalidated, c.confdeltype
      INTO v_convalidated, v_confdeltype
    FROM pg_constraint c
    WHERE c.conname = 'course_offerings_term_id_fkey'
      AND c.conrelid = 'public.course_offerings'::regclass;

    IF v_confdeltype = 'c' THEN
      RAISE EXCEPTION 'COURSE_OFFERING_TERM_FK_CASCADE_FORBIDDEN'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    EXECUTE $ddl$
      ALTER TABLE public.course_offerings
        ADD CONSTRAINT course_offerings_term_id_fkey
        FOREIGN KEY (term_id)
        REFERENCES public.academic_terms(id)
        ON DELETE RESTRICT
        NOT VALID
    $ddl$;
  END IF;

  SELECT c.convalidated, c.confdeltype
    INTO v_convalidated, v_confdeltype
  FROM pg_constraint c
  WHERE c.conname = 'course_offerings_term_id_fkey'
    AND c.conrelid = 'public.course_offerings'::regclass;

  IF v_confdeltype IS DISTINCT FROM 'r' AND v_confdeltype IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'COURSE_OFFERING_TERM_FK_DELETE_ACTION_INVALID'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Must remain NOT VALID in this phase (legacy orphans stay)
  IF v_convalidated IS TRUE THEN
    RAISE EXCEPTION 'COURSE_OFFERING_TERM_FK_UNEXPECTEDLY_VALIDATED'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'COURSE_OFFERING_TERM_HARDENING',
    'course_offerings',
    NULL,
    NULL,
    jsonb_build_object(
      'operation', 'COURSE_OFFERING_TERM_HARDENING',
      'actor', 'migration_executor',
      'index_name', 'idx_course_offerings_term_id',
      'fk_name', 'course_offerings_term_id_fkey',
      'fk_validated', false,
      'on_delete_behavior', 'RESTRICT',
      'not_valid', true,
      'legacy_orphans_untouched', true,
      'validate_constraint', false,
      'result', 'success',
      'executed_at', clock_timestamp()
    )
  );
END $$;

-- Term delete snapshot (unused terms only â€” RESTRICT blocks terms referenced by validated/new rows)
CREATE OR REPLACE FUNCTION public.enforce_academic_term_delete_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offering_refs integer;
  v_deleted_at timestamptz := now();
  v_deleted_by uuid := auth.uid();
BEGIN
  SELECT COUNT(*)::integer INTO v_offering_refs
  FROM public.course_offerings
  WHERE term_id = OLD.id;

  -- With NOT VALID FK, orphans may still reference missing terms; count only rows
  -- that would be blocked by RESTRICT for real existing terms (same-college offerings).
  IF v_offering_refs > 0 THEN
    RAISE EXCEPTION
      'TERM_IN_USE: Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø­Ø°Ù Ø§Ù„ÙØµÙ„ Ø§Ù„Ø¯Ø±Ø§Ø³ÙŠ Ù„Ø£Ù†Ù‡ Ù…Ø±ØªØ¨Ø· Ø¨Ø¹Ø±ÙˆØ¶ Ù…Ù‚Ø±Ø±Ø§Øª.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_deleted_by,
    'academic_term_delete_snapshot',
    'academic_terms',
    OLD.id,
    OLD.college_id,
    jsonb_build_object(
      'id', OLD.id,
      'college_id', OLD.college_id,
      'academic_year', OLD.academic_year,
      'term_type', OLD.term_type,
      'name', OLD.name,
      'code', OLD.code,
      'start_date', OLD.start_date,
      'end_date', OLD.end_date,
      'is_active', OLD.is_active,
      'deleted_by', v_deleted_by,
      'deleted_at', v_deleted_at,
      'snapshot', to_jsonb(OLD),
      'note', 'Unused academic term deleted; details never NULL'
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_academic_terms_delete_integrity ON public.academic_terms;
CREATE TRIGGER trg_academic_terms_delete_integrity
  BEFORE DELETE ON public.academic_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_academic_term_delete_integrity();

REVOKE ALL ON FUNCTION public.enforce_academic_term_delete_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_academic_term_delete_integrity() TO authenticated, service_role;

COMMENT ON CONSTRAINT course_offerings_term_id_fkey ON public.course_offerings IS
  'NOT VALID FK: blocks new/updated orphan term_id; legacy orphans untouched until separate cleanup; ON DELETE RESTRICT.';

COMMIT;
