-- M-11 / M-9 (track C): data-driven scheduling policy exceptions.
--
-- Replaces production UUID literals that lived in browser code:
--   * delivery-group-waiver.ts (college/term/version scoped delivery_group_conflict waiver)
--   * education-publication.ts / existing-schedule-workspace.tsx / college-source-timetable.tsx
--     (sealed education source publication)
--   * physical-rooms.ts (three room rows that are aliases of one physical hall)
--   * disposable-purge.ts / drag-drop-safety.ts / purge function (protected accepted version)
-- Every seed reproduces the CURRENT behaviour exactly and is inserted only when the
-- referenced rows exist, so empty databases replay cleanly.
--
-- Also adds schedule_versions.published_at (M-9), backfilled from lifecycle events.
BEGIN;

CREATE TABLE IF NOT EXISTS public.scheduling_policy_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  schedule_version_id uuid REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  rule_code text NOT NULL,
  reason text NOT NULL,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spe_rule_code_nonempty CHECK (btrim(rule_code) <> ''),
  CONSTRAINT spe_reason_nonempty CHECK (btrim(reason) <> ''),
  -- These rules are never waivable (AGENTS.md: ITCS 14:00 rule; cohort component single instructor).
  CONSTRAINT spe_not_unwaivable CHECK (rule_code NOT IN ('itcs_theory_after_14', 'cohort_component_single_instructor'))
);
CREATE INDEX IF NOT EXISTS idx_spe_college_rule ON public.scheduling_policy_exceptions (college_id, rule_code);
CREATE INDEX IF NOT EXISTS idx_spe_version_rule ON public.scheduling_policy_exceptions (schedule_version_id, rule_code)
  WHERE schedule_version_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_spe_scope_rule ON public.scheduling_policy_exceptions
  (college_id, rule_code, COALESCE(schedule_version_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE public.scheduling_policy_exceptions IS
  'Super-admin approved policy exceptions (rule waivers and sealed publication markers). '
  'rule_code = a conflict code (e.g. delivery_group_conflict) downgrades that hard conflict to a '
  'waived warning inside its scope; education_source_publication marks a sealed source timetable. '
  'Read by compute_version_hard_conflicts and the client. Never covers itcs_theory_after_14 or '
  'cohort_component_single_instructor.';

ALTER TABLE public.scheduling_policy_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spe_select ON public.scheduling_policy_exceptions;
CREATE POLICY spe_select ON public.scheduling_policy_exceptions FOR SELECT TO authenticated
  USING (public.can_view_college((SELECT auth.uid()), college_id));
DROP POLICY IF EXISTS spe_insert ON public.scheduling_policy_exceptions;
CREATE POLICY spe_insert ON public.scheduling_policy_exceptions FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));
DROP POLICY IF EXISTS spe_update ON public.scheduling_policy_exceptions;
CREATE POLICY spe_update ON public.scheduling_policy_exceptions FOR UPDATE TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));
DROP POLICY IF EXISTS spe_delete ON public.scheduling_policy_exceptions;
CREATE POLICY spe_delete ON public.scheduling_policy_exceptions FOR DELETE TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));
REVOKE ALL ON public.scheduling_policy_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_policy_exceptions TO authenticated;
GRANT ALL ON public.scheduling_policy_exceptions TO service_role;

-- Client writes always carry the real approver.
CREATE OR REPLACE FUNCTION public.enforce_scheduling_policy_exception_approver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') OR auth.uid() IS NOT NULL THEN
    IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'POLICY_EXCEPTION_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  IF NEW.schedule_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.schedule_versions v
    WHERE v.id = NEW.schedule_version_id AND v.college_id = NEW.college_id) THEN
    RAISE EXCEPTION 'POLICY_EXCEPTION_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_scheduling_policy_exception_approver() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_spe_approver ON public.scheduling_policy_exceptions;
CREATE TRIGGER trg_spe_approver BEFORE INSERT OR UPDATE ON public.scheduling_policy_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scheduling_policy_exception_approver();

-- Physical hall aliases (was QARDAI_ROOM_IDS in src/lib/reports/physical-rooms.ts).
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS physical_group_key text;
COMMENT ON COLUMN public.rooms.physical_group_key IS
  'Rows sharing a key are aliases of ONE physical hall (verified by the administrator); NULL = the row itself.';
UPDATE public.rooms SET physical_group_key = 'shared:qardai'
WHERE id IN ('0b097849-0658-4d29-a3a7-ee0aaa0e91f2',
             '35355e05-f45a-4f35-875e-3dec562574cd',
             '4e19eef6-6a23-55d5-bfde-1a4af775fbd0')
  AND physical_group_key IS DISTINCT FROM 'shared:qardai';

-- Members of a physical group may live in colleges the reader cannot see; expose only counts.
CREATE OR REPLACE FUNCTION public.physical_room_group_sizes()
RETURNS TABLE (group_key text, room_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT r.physical_group_key, count(*)::integer
  FROM public.rooms r
  WHERE r.physical_group_key IS NOT NULL AND auth.uid() IS NOT NULL
  GROUP BY r.physical_group_key
$fn$;
REVOKE ALL ON FUNCTION public.physical_room_group_sizes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.physical_room_group_sizes() TO authenticated, service_role;

-- Protected versions (was the literal 835e50fe-... in the purge function and two client files).
ALTER TABLE public.schedule_versions ADD COLUMN IF NOT EXISTS protected boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.schedule_versions.protected IS
  'Accepted/reference version that must never be purged or used as a drag-drop sandbox.';
UPDATE public.schedule_versions SET protected = true
WHERE id = '835e50fe-3ad2-4232-8c15-0f403c668a7f' AND NOT protected;

-- M-9: publication timestamp for "current published version" readers.
-- Set by transition_schedule_version on every new publication. Existing rows are NOT
-- rewritten here (an UPDATE on published versions would re-run the deferred coordination
-- checks on historical data); readers fall back to the last 'published' lifecycle event,
-- then updated_at -- see public.schedule_version_published_at().
ALTER TABLE public.schedule_versions ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE OR REPLACE FUNCTION public.schedule_version_published_at(p_version_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(v.published_at,
    (SELECT max(e.created_at) FROM public.schedule_version_events e
     WHERE e.schedule_version_id = v.id AND e.to_status = 'published'),
    v.updated_at)
  FROM public.schedule_versions v WHERE v.id = p_version_id
$fn$;
REVOKE ALL ON FUNCTION public.schedule_version_published_at(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_version_published_at(uuid) TO authenticated, service_role;

-- Seeds reproducing the current hard-coded behaviour.
INSERT INTO public.scheduling_policy_exceptions
  (college_id, schedule_version_id, rule_code, reason, metadata)
SELECT v.college_id, v.id, 'delivery_group_conflict',
  'استثناء مؤقت للفصل الحالي فقط: تعارضات عضوية المجموعات الطلابية في هذه النسخة تُعرض كتحذيرات ولا تمنع الاعتماد، لأنها ناتجة عن بيانات مجموعات قديمة غير مربوطة. تعارضات المحاضر والقاعة والوقت ما زالت مانعة.',
  jsonb_build_object('term_id', v.academic_term_id, 'term_name', 'الفصل الأول 2026-2027',
    'source', 'src/lib/schedule-versions/delivery-group-waiver.ts')
FROM public.schedule_versions v
WHERE v.id = 'c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'
  AND v.college_id = 'f30ff526-3918-4395-b8a0-dff1873534bf'
  AND v.academic_term_id = '019af13c-fd67-4fea-81c8-d81ef95e9a5c'
ON CONFLICT DO NOTHING;

INSERT INTO public.scheduling_policy_exceptions
  (college_id, schedule_version_id, rule_code, reason, metadata)
SELECT v.college_id, v.id, 'education_source_publication',
  'جدول كلية التربية والعلوم المعتمد وفق ملفات الأقسام (نسخة المصدر وتصحيح الهوية).',
  jsonb_build_object('term_id', v.academic_term_id,
    'role', CASE WHEN v.id = '7430bad7-2de7-5c90-9368-b214a199d6c3' THEN 'source' ELSE 'identity_revision' END,
    'source', 'src/lib/schedule-versions/education-publication.ts')
FROM public.schedule_versions v
WHERE v.id IN ('7430bad7-2de7-5c90-9368-b214a199d6c3', '3fc16124-dbfa-4fc0-93c9-db1ea9a560dd')
  AND v.college_id = '1ee291b2-bec9-43d3-b42b-5a4f46946399'
  AND v.academic_term_id = '93705393-609d-4605-ae94-9572cd8b2090'
ON CONFLICT DO NOTHING;

COMMIT;
