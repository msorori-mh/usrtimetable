-- Scheduling policy centre: guarded availability activation, instructor requests,
-- and manual-save enforcement of instructor/student workload policies.
BEGIN;

-- Reconcile the scheduling_settings columns already consumed by the application
-- and production policy functions. Check first instead of issuing unconditional
-- ADD COLUMN IF NOT EXISTS statements: PostgreSQL still takes an exclusive table
-- lock for those no-op statements, which is avoidable on a busy live system.
DO $settings_columns$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduling_settings'
      AND column_name = 'max_daily_theory_hours_per_section'
  ) THEN
    ALTER TABLE public.scheduling_settings
      ADD COLUMN max_daily_theory_hours_per_section integer NOT NULL DEFAULT 6;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduling_settings'
      AND column_name = 'max_daily_practical_hours_per_section'
  ) THEN
    ALTER TABLE public.scheduling_settings
      ADD COLUMN max_daily_practical_hours_per_section integer NOT NULL DEFAULT 8;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduling_settings'
      AND column_name = 'extended_day_policy_enabled'
  ) THEN
    ALTER TABLE public.scheduling_settings
      ADD COLUMN extended_day_policy_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduling_settings'
      AND column_name = 'standard_day_end_time'
  ) THEN
    ALTER TABLE public.scheduling_settings
      ADD COLUMN standard_day_end_time time without time zone NOT NULL DEFAULT '14:00';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduling_settings'
      AND column_name = 'max_extended_days_per_partition'
  ) THEN
    ALTER TABLE public.scheduling_settings
      ADD COLUMN max_extended_days_per_partition integer NOT NULL DEFAULT 2;
  END IF;
END
$settings_columns$;

-- Make the enforced policies visible in the rule catalogue. Their limits are
-- configured in scheduling_settings / instructor records, not by fake weights.
INSERT INTO public.constraint_types(
  code, name_ar, name_en, constraint_category, is_hard, default_weight, description
) VALUES
  ('instructor_daily_hours', 'سقف ساعات المحاضر اليومية', 'Instructor daily hours',
    'hard', true, 100, 'يمنع تجاوز الحد اليومي العام أو الحد الخاص بالمحاضر'),
  ('instructor_attendance_days', 'الحد الأعلى لأيام حضور المحاضر', 'Instructor attendance days',
    'hard', true, 100, 'يمنع تجاوز الحد الأسبوعي الصريح لأيام حضور المحاضر'),
  ('student_daily_hours', 'سقف ساعات الطلاب اليومية', 'Student daily hours',
    'hard', true, 100, 'يمنع تجاوز إجمالي العبء اليومي لمجموعة الطلاب'),
  ('student_daily_theory_hours', 'سقف النظري اليومي للطلاب', 'Student daily theory hours',
    'hard', true, 100, 'يمنع تجاوز الساعات النظرية اليومية المحددة'),
  ('student_daily_practical_hours', 'سقف العملي اليومي للطلاب', 'Student daily practical hours',
    'hard', true, 100, 'يمنع تجاوز الساعات العملية اليومية المحددة'),
  ('student_extended_days', 'أيام التدريس الممتدة للطلاب', 'Student extended days',
    'hard', true, 100, 'يمنع تجاوز عدد أيام التدريس الممتدة المعتمد'),
  ('outside_working_days', 'أيام الدوام المعتمدة', 'Working days',
    'hard', true, 100, 'يمنع الجدولة خارج أيام الدوام المعتمدة'),
  ('outside_working_hours', 'ساعات الدوام المعتمدة', 'Working hours',
    'hard', true, 100, 'يمنع الجدولة خارج ساعات الدوام المعتمدة'),
  ('study_system_time_template', 'قوالب أوقات نظام الدراسة', 'Study-system time templates',
    'hard', true, 100, 'يمنع الموعد الخارج عن قالب النظام الدراسي'),
  ('daily_break', 'الاستراحة اليومية', 'Daily break',
    'hard', true, 100, 'يمنع تداخل الجلسة مع استراحة إلزامية'),
  ('room_type_mismatch', 'ملاءمة نوع القاعة', 'Room type compatibility',
    'hard', true, 100, 'يمنع استخدام مورد لا يطابق طبيعة المكوّن'),
  ('itcs_theory_after_14', 'نهاية نظري الحاسوب عند 14:00', 'ITCS theory cutoff',
    'hard', true, 100, 'النظري والتمارين في كلية الحاسوب ينتهيان عند 14:00')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- One authoritative interpretation of HARD instructor availability.
-- External / visiting staff need a positive window. Permanent staff are
-- available by default outside explicit blacklist windows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ss_iavail_req(
  p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_code text;
  v_external boolean;
  v_required boolean;
  v_positive integer;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
  SELECT it.code, it.is_external INTO v_code, v_external
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.id = p_iid;
  v_required := lower(coalesce(v_code, '')) = 'from_other_college'
    OR coalesce(v_external, false);
  IF NOT v_required THEN RETURN v; END IF;

  SELECT count(*) INTO v_positive
  FROM public.instructor_availability ia
  WHERE ia.instructor_id = p_iid
    AND ia.day_of_week = p_dow
    AND ia.is_preference = false
    AND ia.college_id = p_cid
    AND ia.availability_type IS DISTINCT FROM 'unavailable';
  IF v_positive = 0 THEN
    v := v || jsonb_build_array(public._ss_ci(
      'instructor_availability_required', 'hard', p_sid, NULL,
      jsonb_build_object('instructor_id', p_iid, 'day_of_week', p_dow)
    ));
  END IF;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ss_iavail_win(
  p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer,
  p_st time without time zone, p_et time without time zone
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_code text;
  v_external boolean;
  v_required boolean;
  v_positive integer;
  v_fits boolean;
  v_blocked boolean;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
  SELECT it.code, it.is_external INTO v_code, v_external
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.id = p_iid;
  v_required := lower(coalesce(v_code, '')) = 'from_other_college'
    OR coalesce(v_external, false);

  SELECT count(*), coalesce(bool_or(p_st >= ia.start_time AND p_et <= ia.end_time), false)
  INTO v_positive, v_fits
  FROM public.instructor_availability ia
  WHERE ia.instructor_id = p_iid
    AND ia.day_of_week = p_dow
    AND ia.is_preference = false
    AND ia.college_id = p_cid
    AND ia.availability_type IS DISTINCT FROM 'unavailable';

  SELECT EXISTS (
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id = p_iid
      AND ia.day_of_week = p_dow
      AND ia.is_preference = false
      AND ia.college_id = p_cid
      AND ia.availability_type = 'unavailable'
      AND ia.start_time < p_et AND p_st < ia.end_time
  ) INTO v_blocked;

  -- Missing positive availability for a required category is emitted by
  -- _ss_iavail_req, avoiding duplicate conflicts here.
  IF v_blocked OR (v_positive > 0 AND NOT v_fits) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'instructor_availability', 'hard', p_sid, NULL,
      jsonb_build_object('instructor_id', p_iid, 'day_of_week', p_dow)
    ));
  ELSIF v_required AND v_positive = 0 THEN
    RETURN v;
  END IF;
  RETURN v;
END;
$function$;

-- Keep guarded activation true after it is enabled: direct RLS-authorised DML
-- cannot remove the final positive hard window of a required instructor.
CREATE OR REPLACE FUNCTION public.guard_required_instructor_availability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_required boolean := false;
  v_removes_positive boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_removes_positive := OLD.is_preference = false
      AND OLD.availability_type IS DISTINCT FROM 'unavailable';
  ELSE
    v_removes_positive := OLD.is_preference = false
      AND OLD.availability_type IS DISTINCT FROM 'unavailable'
      AND (
        NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
        OR NEW.college_id IS DISTINCT FROM OLD.college_id
        OR NEW.is_preference = true
        OR NEW.availability_type = 'unavailable'
      );
  END IF;
  IF NOT v_removes_positive OR NOT public.instructor_availability_enforced(OLD.college_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT coalesce(it.is_external, false)
         OR lower(coalesce(it.code, '')) = 'from_other_college'
    INTO v_required
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.id = OLD.instructor_id;

  IF coalesce(v_required, false) AND NOT EXISTS (
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.id <> OLD.id AND ia.college_id = OLD.college_id
      AND ia.instructor_id = OLD.instructor_id AND ia.is_preference = false
      AND ia.availability_type IS DISTINCT FROM 'unavailable'
  ) THEN
    RAISE EXCEPTION 'AVAILABILITY_REQUIRED_WHILE_ENFORCED'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_required_instructor_availability
  ON public.instructor_availability;
CREATE TRIGGER trg_guard_required_instructor_availability
  BEFORE DELETE OR UPDATE ON public.instructor_availability
  FOR EACH ROW EXECUTE FUNCTION public.guard_required_instructor_availability();

-- ---------------------------------------------------------------------------
-- Instructor scheduling requests. These are entered by an authorised college
-- manager on behalf of the lecturer and only affect live policy after approval.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instructor_scheduling_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
  request_kind text NOT NULL CHECK (request_kind IN (
    'hard_available', 'hard_unavailable',
    'preferred_available', 'preferred_unavailable',
    'daily_limit', 'attendance_days'
  )),
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time without time zone,
  end_time time without time zone,
  max_hours_per_day smallint,
  target_attendance_days smallint,
  max_attendance_days smallint,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  review_note text,
  applied_availability_id uuid REFERENCES public.instructor_availability(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT instructor_scheduling_request_payload CHECK (
    (
      request_kind IN ('hard_available', 'hard_unavailable', 'preferred_available', 'preferred_unavailable')
      AND day_of_week IS NOT NULL AND start_time IS NOT NULL AND end_time > start_time
      AND max_hours_per_day IS NULL AND target_attendance_days IS NULL AND max_attendance_days IS NULL
    ) OR (
      request_kind = 'daily_limit'
      AND max_hours_per_day BETWEEN 1 AND 12
      AND day_of_week IS NULL AND start_time IS NULL AND end_time IS NULL
      AND target_attendance_days IS NULL AND max_attendance_days IS NULL
    ) OR (
      request_kind = 'attendance_days'
      AND target_attendance_days BETWEEN 1 AND 6
      AND max_attendance_days BETWEEN 1 AND 6
      AND target_attendance_days <= max_attendance_days
      AND day_of_week IS NULL AND start_time IS NULL AND end_time IS NULL
      AND max_hours_per_day IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS instructor_scheduling_requests_college_status_idx
  ON public.instructor_scheduling_requests(college_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS instructor_scheduling_requests_instructor_idx
  ON public.instructor_scheduling_requests(instructor_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS instructor_scheduling_requests_one_pending_payload
  ON public.instructor_scheduling_requests(
    college_id, instructor_id, request_kind,
    coalesce(day_of_week, -1), coalesce(start_time, '00:00'::time),
    coalesce(end_time, '00:00'::time)
  ) WHERE status = 'submitted';

ALTER TABLE public.instructor_scheduling_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instructor_scheduling_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instructor_scheduling_requests TO service_role;

DROP POLICY IF EXISTS instructor_scheduling_requests_select ON public.instructor_scheduling_requests;
CREATE POLICY instructor_scheduling_requests_select
  ON public.instructor_scheduling_requests FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));

DROP TRIGGER IF EXISTS trg_instructor_scheduling_requests_updated ON public.instructor_scheduling_requests;
CREATE TRIGGER trg_instructor_scheduling_requests_updated
  BEFORE UPDATE ON public.instructor_scheduling_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_instructor_scheduling_request(
  p_college_id uuid,
  p_instructor_id uuid,
  p_request_kind text,
  p_day_of_week integer DEFAULT NULL,
  p_start_time time without time zone DEFAULT NULL,
  p_end_time time without time zone DEFAULT NULL,
  p_max_hours_per_day integer DEFAULT NULL,
  p_target_attendance_days integer DEFAULT NULL,
  p_max_attendance_days integer DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_request public.instructor_scheduling_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'REQUEST_REASON_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.instructors i
    WHERE i.id = p_instructor_id AND i.college_id = p_college_id AND i.is_active
  ) THEN
    RAISE EXCEPTION 'INSTRUCTOR_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.instructor_scheduling_requests (
    college_id, instructor_id, request_kind, day_of_week, start_time, end_time,
    max_hours_per_day, target_attendance_days, max_attendance_days, reason, requested_by
  ) VALUES (
    p_college_id, p_instructor_id, p_request_kind, p_day_of_week, p_start_time, p_end_time,
    p_max_hours_per_day, p_target_attendance_days, p_max_attendance_days,
    btrim(p_reason), v_uid
  ) RETURNING * INTO v_request;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'instructor_scheduling_request_submitted',
    'instructor_scheduling_requests', v_request.id, p_college_id,
    jsonb_build_object('instructor_id', p_instructor_id, 'request_kind', p_request_kind));

  RETURN jsonb_build_object('ok', true, 'request_id', v_request.id, 'status', v_request.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_instructor_scheduling_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_request public.instructor_scheduling_requests%ROWTYPE;
  v_availability_id uuid;
  v_type text;
  v_preference boolean;
BEGIN
  SELECT * INTO v_request
  FROM public.instructor_scheduling_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, v_request.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_REQUEST_DECISION' USING ERRCODE = '23514';
  END IF;
  IF v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_DECIDED' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(coalesce(p_review_note, ''))) < 3 THEN
    RAISE EXCEPTION 'REQUEST_REVIEW_NOTE_REQUIRED' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'approved' THEN
    IF v_request.request_kind IN (
      'hard_available', 'hard_unavailable', 'preferred_available', 'preferred_unavailable'
    ) THEN
      v_type := CASE WHEN v_request.request_kind LIKE '%unavailable'
        THEN 'unavailable' ELSE 'available' END;
      v_preference := v_request.request_kind LIKE 'preferred_%';
      SELECT ia.id INTO v_availability_id
      FROM public.instructor_availability ia
      WHERE ia.college_id = v_request.college_id
        AND ia.instructor_id = v_request.instructor_id
        AND ia.day_of_week = v_request.day_of_week
        AND ia.start_time = v_request.start_time
        AND ia.end_time = v_request.end_time
        AND ia.availability_type = v_type
        AND ia.is_preference = v_preference
      LIMIT 1;
      IF v_availability_id IS NULL THEN
        INSERT INTO public.instructor_availability(
          college_id, instructor_id, day_of_week, start_time, end_time,
          availability_type, is_preference, notes
        ) VALUES (
          v_request.college_id, v_request.instructor_id, v_request.day_of_week,
          v_request.start_time, v_request.end_time, v_type, v_preference,
          'طلب محاضر معتمد: ' || v_request.reason
        ) RETURNING id INTO v_availability_id;
      END IF;
    ELSIF v_request.request_kind = 'daily_limit' THEN
      UPDATE public.instructors
      SET max_hours_per_day = v_request.max_hours_per_day
      WHERE id = v_request.instructor_id AND college_id = v_request.college_id;
    ELSIF v_request.request_kind = 'attendance_days' THEN
      UPDATE public.instructors
      SET target_attendance_days_per_week = v_request.target_attendance_days,
          max_attendance_days_per_week = v_request.max_attendance_days
      WHERE id = v_request.instructor_id AND college_id = v_request.college_id;
    END IF;
  END IF;

  UPDATE public.instructor_scheduling_requests
  SET status = p_decision,
      reviewed_by = v_uid,
      review_note = btrim(p_review_note),
      reviewed_at = now(),
      applied_availability_id = v_availability_id
  WHERE id = v_request.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'instructor_scheduling_request_' || p_decision,
    'instructor_scheduling_requests', v_request.id, v_request.college_id,
    jsonb_build_object('instructor_id', v_request.instructor_id,
      'request_kind', v_request.request_kind, 'review_note', btrim(p_review_note)));

  RETURN jsonb_build_object('ok', true, 'request_id', v_request.id,
    'status', p_decision, 'applied_availability_id', v_availability_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_instructor_scheduling_requests(p_college_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'instructor_id', r.instructor_id,
    'instructor_name', i.full_name,
    'request_kind', r.request_kind,
    'day_of_week', r.day_of_week,
    'start_time', r.start_time,
    'end_time', r.end_time,
    'max_hours_per_day', r.max_hours_per_day,
    'target_attendance_days', r.target_attendance_days,
    'max_attendance_days', r.max_attendance_days,
    'reason', r.reason,
    'status', r.status,
    'review_note', r.review_note,
    'created_at', r.created_at,
    'reviewed_at', r.reviewed_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.instructor_scheduling_requests r
  JOIN public.instructors i ON i.id = r.instructor_id
  WHERE r.college_id = p_college_id;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_instructor_availability_windows(
  p_college_id uuid,
  p_instructor_id uuid,
  p_window_kind text,
  p_day_of_week integer,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_days integer[];
  v_type text;
  v_preference boolean;
  v_created integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_window_kind NOT IN (
    'hard_available', 'hard_unavailable', 'preferred_available', 'preferred_unavailable'
  ) THEN RAISE EXCEPTION 'INVALID_WINDOW_KIND' USING ERRCODE = '23514'; END IF;
  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE' USING ERRCODE = '22023';
  END IF;
  IF p_day_of_week IS NOT NULL AND p_day_of_week NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'INVALID_DAY' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.instructors i
    WHERE i.id = p_instructor_id AND i.college_id = p_college_id AND i.is_active
  ) THEN RAISE EXCEPTION 'INSTRUCTOR_SCOPE_MISMATCH' USING ERRCODE = '23514'; END IF;

  v_days := CASE WHEN p_day_of_week IS NULL
    THEN public._availability_active_working_days(p_college_id)
    ELSE ARRAY[p_day_of_week] END;
  v_type := CASE WHEN p_window_kind LIKE '%unavailable'
    THEN 'unavailable' ELSE 'available' END;
  v_preference := p_window_kind LIKE 'preferred_%';

  INSERT INTO public.instructor_availability(
    college_id, instructor_id, day_of_week, start_time, end_time,
    availability_type, is_preference, notes
  )
  SELECT p_college_id, p_instructor_id, day_value, p_start_time, p_end_time,
    v_type, v_preference, nullif(btrim(coalesce(p_notes, '')), '')
  FROM unnest(v_days) AS day_value
  WHERE NOT EXISTS (
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.college_id = p_college_id AND ia.instructor_id = p_instructor_id
      AND ia.day_of_week = day_value AND ia.start_time = p_start_time
      AND ia.end_time = p_end_time AND ia.availability_type = v_type
      AND ia.is_preference = v_preference
  );
  GET DIAGNOSTICS v_created = ROW_COUNT;

  INSERT INTO public.audit_logs(actor_id, action, entity, college_id, details)
  VALUES (v_uid, 'upsert_instructor_availability_windows', 'instructor_availability',
    p_college_id, jsonb_build_object('instructor_id', p_instructor_id,
      'window_kind', p_window_kind, 'days', v_days, 'created', v_created,
      'start_time', p_start_time, 'end_time', p_end_time));
  RETURN jsonb_build_object('ok', true, 'days_targeted', cardinality(v_days),
    'days_created', v_created, 'days_unchanged', cardinality(v_days) - v_created);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Readiness and guarded activation. Activation cannot silently make every
-- external instructor unschedulable because their positive windows are absent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_instructor_availability_readiness(p_college_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total integer;
  v_required integer;
  v_missing integer;
  v_hard integer;
  v_preferences integer;
  v_pending integer;
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.instructors i
    WHERE i.college_id = p_college_id AND i.is_active;
  SELECT count(*) INTO v_required
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.college_id = p_college_id AND i.is_active
    AND (coalesce(it.is_external, false) OR lower(coalesce(it.code, '')) = 'from_other_college');
  SELECT count(*) INTO v_missing
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.college_id = p_college_id AND i.is_active
    AND (coalesce(it.is_external, false) OR lower(coalesce(it.code, '')) = 'from_other_college')
    AND NOT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.college_id = p_college_id AND ia.instructor_id = i.id
        AND ia.is_preference = false
        AND ia.availability_type IS DISTINCT FROM 'unavailable'
    );
  SELECT count(*) FILTER (WHERE NOT ia.is_preference),
         count(*) FILTER (WHERE ia.is_preference)
    INTO v_hard, v_preferences
  FROM public.instructor_availability ia WHERE ia.college_id = p_college_id;
  SELECT count(*) INTO v_pending FROM public.instructor_scheduling_requests r
    WHERE r.college_id = p_college_id AND r.status = 'submitted';
  SELECT coalesce(ss.enforce_instructor_availability, false) INTO v_enabled
    FROM public.scheduling_settings ss WHERE ss.college_id = p_college_id;
  RETURN jsonb_build_object(
    'college_id', p_college_id,
    'enabled', coalesce(v_enabled, false),
    'active_instructors', coalesce(v_total, 0),
    'required_instructors', coalesce(v_required, 0),
    'missing_required_instructors', coalesce(v_missing, 0),
    'hard_windows', coalesce(v_hard, 0),
    'preference_windows', coalesce(v_preferences, 0),
    'pending_requests', coalesce(v_pending, 0),
    'can_activate', coalesce(v_missing, 0) = 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_instructor_availability_enforcement(
  p_college_id uuid, p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_readiness jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  v_readiness := public.get_instructor_availability_readiness(p_college_id);
  IF p_enabled AND NOT coalesce((v_readiness->>'can_activate')::boolean, false) THEN
    RAISE EXCEPTION 'AVAILABILITY_NOT_READY' USING ERRCODE = '23514',
      DETAIL = v_readiness::text;
  END IF;
  INSERT INTO public.scheduling_settings(college_id, enforce_instructor_availability)
  VALUES (p_college_id, p_enabled)
  ON CONFLICT (college_id) DO UPDATE
    SET enforce_instructor_availability = excluded.enforce_instructor_availability,
        updated_at = now()
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'set_instructor_availability_enforcement', 'scheduling_settings',
    v_id, p_college_id, jsonb_build_object('enabled', p_enabled, 'readiness', v_readiness));
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled, 'readiness', v_readiness);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Manual create/move must honour the same instructor daily-hours setting as
-- automatic generation. Existing violations may not be enlarged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ss_instructor_daily_hours(
  p_sid uuid, p_cid uuid, p_vid uuid, p_iid uuid, p_dow integer,
  p_st time without time zone, p_et time without time zone
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_existing numeric;
  v_prior numeric;
  v_limit numeric;
  v_proposed numeric;
BEGIN
  SELECT coalesce(sum(extract(epoch FROM (s.end_time - s.start_time)) / 3600), 0)
    INTO v_existing
  FROM public.schedule_sessions s
  WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
    AND s.id IS DISTINCT FROM p_sid
    AND s.instructor_id = p_iid AND s.day_of_week = p_dow
    AND NOT coalesce(s.replaced_by_split, false);
  SELECT coalesce(sum(extract(epoch FROM (s.end_time - s.start_time)) / 3600), 0)
    INTO v_prior
  FROM public.schedule_sessions s
  WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
    AND s.instructor_id = p_iid AND s.day_of_week = p_dow
    AND NOT coalesce(s.replaced_by_split, false);
  SELECT coalesce(i.max_hours_per_day, cfg.max_daily_hours_per_instructor, 8)
    INTO v_limit
  FROM public.instructors i
  LEFT JOIN public.scheduling_settings cfg ON cfg.college_id = p_cid
  WHERE i.id = p_iid;
  v_proposed := extract(epoch FROM (p_et - p_st)) / 3600;
  IF v_existing + v_proposed > greatest(coalesce(v_limit, 8), v_prior) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'instructor_daily_hours', 'hard', p_sid, NULL,
      jsonb_build_object('instructor_id', p_iid, 'day_of_week', p_dow,
        'existing_hours', v_existing, 'proposed_hours', v_proposed,
        'limit_hours', coalesce(v_limit, 8))
    ));
  END IF;
  RETURN v;
END;
$function$;

-- An explicit instructor maximum is a hard weekly attendance-day ceiling.
-- The target remains a quality preference and is not turned into a hard rule.
CREATE OR REPLACE FUNCTION public._ss_instructor_attendance_days(
  p_sid uuid, p_cid uuid, p_vid uuid, p_iid uuid, p_dow integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_limit integer;
  v_existing integer := 0;
  v_prior integer := 0;
  v_day_exists boolean := false;
  v_next integer;
BEGIN
  SELECT i.max_attendance_days_per_week INTO v_limit
  FROM public.instructors i WHERE i.id = p_iid AND i.college_id = p_cid;
  IF v_limit IS NULL THEN RETURN v; END IF;

  SELECT count(DISTINCT s.day_of_week) FILTER (WHERE s.id IS DISTINCT FROM p_sid),
         count(DISTINCT s.day_of_week),
         coalesce(bool_or(s.day_of_week = p_dow) FILTER (WHERE s.id IS DISTINCT FROM p_sid), false)
    INTO v_existing, v_prior, v_day_exists
  FROM public.schedule_sessions s
  WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
    AND s.instructor_id = p_iid AND NOT coalesce(s.replaced_by_split, false);

  v_next := v_existing + CASE WHEN v_day_exists THEN 0 ELSE 1 END;
  IF v_next > greatest(v_limit, v_prior) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'instructor_attendance_days', 'hard', p_sid, NULL,
      jsonb_build_object('instructor_id', p_iid, 'next_days', v_next,
        'limit_days', v_limit, 'proposed_day', p_dow)
    ));
  END IF;
  RETURN v;
END;
$function$;

-- Daily student load is enforced for manual create/move as well as generation.
-- Unknown component types count as theory (fail closed). The existing server
-- overlap rule is cohort-conservative, so this collector follows the same scope.
CREATE OR REPLACE FUNCTION public._ss_student_daily_hours(
  p_sid uuid, p_cid uuid, p_vid uuid, p_section_id uuid, p_ta_id uuid,
  p_dow integer, p_st time without time zone, p_et time without time zone
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_cohort_id uuid;
  v_delivery_group_id uuid;
  v_kind text := 'theory';
  v_total_limit numeric := 8;
  v_theory_limit numeric := 6;
  v_practical_limit numeric := 8;
  v_proposed numeric := extract(epoch FROM (p_et - p_st)) / 3600;
  v_existing_total numeric := 0;
  v_existing_theory numeric := 0;
  v_existing_practical numeric := 0;
  v_prior_total numeric := 0;
  v_prior_theory numeric := 0;
  v_prior_practical numeric := 0;
  v_next_total numeric;
  v_next_kind numeric;
BEGIN
  SELECT ta.cohort_id, ta.delivery_group_id,
         CASE WHEN lower(coalesce(pcc.component_type, ta.session_type, ''))
                    IN ('practical', 'lab', 'laboratory')
              THEN 'practical' ELSE 'theory' END
    INTO v_cohort_id, v_delivery_group_id, v_kind
  FROM public.teaching_assignments ta
  LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
  WHERE ta.id = p_ta_id;

  IF p_section_id IS NULL AND v_cohort_id IS NULL AND v_delivery_group_id IS NULL THEN
    RETURN v;
  END IF;

  SELECT coalesce(cfg.max_daily_hours_per_section, 8),
         least(coalesce(cfg.max_daily_theory_hours_per_section,
                        cfg.max_daily_hours_per_section, 8),
               coalesce(cfg.max_daily_hours_per_section, 8)),
         least(coalesce(cfg.max_daily_practical_hours_per_section,
                        cfg.max_daily_hours_per_section, 8),
               coalesce(cfg.max_daily_hours_per_section, 8))
    INTO v_total_limit, v_theory_limit, v_practical_limit
  FROM public.scheduling_settings cfg
  WHERE cfg.college_id = p_cid;
  v_total_limit := coalesce(v_total_limit, 8);
  v_theory_limit := least(coalesce(v_theory_limit, v_total_limit), v_total_limit);
  v_practical_limit := least(coalesce(v_practical_limit, v_total_limit), v_total_limit);

  WITH relevant AS (
    SELECT s.id,
      extract(epoch FROM (s.end_time - s.start_time)) / 3600 AS hours,
      CASE WHEN lower(coalesce(pcc.component_type, ta.session_type, s.session_type, ''))
                   IN ('practical', 'lab', 'laboratory')
        THEN 'practical' ELSE 'theory' END AS kind
    FROM public.schedule_sessions s
    LEFT JOIN public.teaching_assignments ta ON ta.id = s.teaching_assignment_id
    LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
    WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
      AND s.day_of_week = p_dow AND NOT coalesce(s.replaced_by_split, false)
      AND (
        (p_section_id IS NOT NULL AND s.section_id = p_section_id)
        OR (v_cohort_id IS NOT NULL AND s.cohort_id = v_cohort_id)
        OR (v_delivery_group_id IS NOT NULL AND s.delivery_group_id = v_delivery_group_id)
      )
  )
  SELECT
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid), 0),
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid AND kind = 'theory'), 0),
    coalesce(sum(hours) FILTER (WHERE id IS DISTINCT FROM p_sid AND kind = 'practical'), 0),
    coalesce(sum(hours), 0),
    coalesce(sum(hours) FILTER (WHERE kind = 'theory'), 0),
    coalesce(sum(hours) FILTER (WHERE kind = 'practical'), 0)
  INTO v_existing_total, v_existing_theory, v_existing_practical,
       v_prior_total, v_prior_theory, v_prior_practical
  FROM relevant;

  v_next_total := v_existing_total + v_proposed;
  v_next_kind := CASE WHEN v_kind = 'practical'
    THEN v_existing_practical + v_proposed
    ELSE v_existing_theory + v_proposed END;

  IF v_next_total > greatest(v_total_limit, v_prior_total) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_total,
        'limit_hours', v_total_limit, 'cohort_id', v_cohort_id,
        'delivery_group_id', v_delivery_group_id, 'section_id', p_section_id)
    ));
  END IF;
  IF v_kind = 'practical'
     AND v_next_kind > greatest(v_practical_limit, v_prior_practical) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_practical_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_kind,
        'limit_hours', v_practical_limit)
    ));
  ELSIF v_kind = 'theory'
     AND v_next_kind > greatest(v_theory_limit, v_prior_theory) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_daily_theory_hours', 'hard', p_sid, NULL,
      jsonb_build_object('day_of_week', p_dow, 'next_hours', v_next_kind,
        'limit_hours', v_theory_limit)
    ));
  END IF;
  RETURN v;
END;
$function$;

-- When extended teaching is enabled, manual edits may use no more than the
-- configured number of late days for the affected student group.
CREATE OR REPLACE FUNCTION public._ss_student_extended_days(
  p_sid uuid, p_cid uuid, p_vid uuid, p_section_id uuid, p_ta_id uuid,
  p_dow integer, p_et time without time zone
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb := '[]'::jsonb;
  v_enabled boolean := false;
  v_cutoff time without time zone := '14:00';
  v_limit integer := 2;
  v_cohort_id uuid;
  v_delivery_group_id uuid;
  v_existing integer := 0;
  v_prior integer := 0;
  v_day_exists boolean := false;
  v_next integer;
BEGIN
  SELECT coalesce(cfg.extended_day_policy_enabled, false),
         coalesce(cfg.standard_day_end_time, '14:00'::time),
         coalesce(cfg.max_extended_days_per_partition, 2)
    INTO v_enabled, v_cutoff, v_limit
  FROM public.scheduling_settings cfg WHERE cfg.college_id = p_cid;
  IF NOT coalesce(v_enabled, false) OR p_et <= coalesce(v_cutoff, '14:00'::time) THEN
    RETURN v;
  END IF;

  SELECT ta.cohort_id, ta.delivery_group_id
    INTO v_cohort_id, v_delivery_group_id
  FROM public.teaching_assignments ta WHERE ta.id = p_ta_id;
  IF p_section_id IS NULL AND v_cohort_id IS NULL AND v_delivery_group_id IS NULL THEN
    RETURN v;
  END IF;

  SELECT count(DISTINCT s.day_of_week) FILTER (WHERE s.id IS DISTINCT FROM p_sid),
         count(DISTINCT s.day_of_week),
         coalesce(bool_or(s.day_of_week = p_dow) FILTER (WHERE s.id IS DISTINCT FROM p_sid), false)
    INTO v_existing, v_prior, v_day_exists
  FROM public.schedule_sessions s
  WHERE s.college_id = p_cid AND s.schedule_version_id = p_vid
    AND s.end_time > v_cutoff AND NOT coalesce(s.replaced_by_split, false)
    AND (
      (p_section_id IS NOT NULL AND s.section_id = p_section_id)
      OR (v_cohort_id IS NOT NULL AND s.cohort_id = v_cohort_id)
      OR (v_delivery_group_id IS NOT NULL AND s.delivery_group_id = v_delivery_group_id)
    );

  v_next := v_existing + CASE WHEN v_day_exists THEN 0 ELSE 1 END;
  IF v_next > greatest(v_limit, v_prior) THEN
    v := v || jsonb_build_array(public._ss_ci(
      'student_extended_days', 'hard', p_sid, NULL,
      jsonb_build_object('next_days', v_next, 'limit_days', v_limit,
        'standard_day_end_time', v_cutoff, 'proposed_day', p_dow,
        'cohort_id', v_cohort_id, 'delivery_group_id', v_delivery_group_id,
        'section_id', p_section_id)
    ));
  END IF;
  RETURN v;
END;
$function$;

-- Preserve every prior collector check, including the mandatory ITCS cutoff.
CREATE OR REPLACE FUNCTION public._ss_gather(
  a uuid, b uuid, c uuid, d uuid, e uuid, f uuid, g uuid,
  h text, i integer, j integer, k time without time zone,
  l time without time zone, m uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT COALESCE(public._ss_peer_i(a,b,c,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_r(a,b,c,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_s(a,b,c,e,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_room_cap(a,b,f,i,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_type(a,b,g,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_av(a,b,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_req(a,b,d,j),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_win(a,b,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_instructor_daily_hours(a,b,c,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_instructor_attendance_days(a,b,c,d,j),'[]'::jsonb)
 ||COALESCE(public._ss_student_daily_hours(a,b,c,e,g,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_student_extended_days(a,b,c,e,g,j,l),'[]'::jsonb)
 ||COALESCE(public._ss_tmpl(a,b,h,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_set(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_brk(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_itcs_theory_hours(a,b,g,l),'[]'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.create_instructor_scheduling_request(
  uuid, uuid, text, integer, time without time zone, time without time zone,
  integer, integer, integer, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_instructor_scheduling_request(uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_instructor_scheduling_requests(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_instructor_availability_readiness(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_instructor_availability_windows(
  uuid, uuid, text, integer, time without time zone, time without time zone, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_instructor_availability_enforcement(uuid, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_required_instructor_availability()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ss_instructor_daily_hours(
  uuid, uuid, uuid, uuid, integer, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ss_student_daily_hours(
  uuid, uuid, uuid, uuid, uuid, integer, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ss_instructor_attendance_days(
  uuid, uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ss_student_extended_days(
  uuid, uuid, uuid, uuid, uuid, integer, time without time zone
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ss_gather(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,
  time without time zone,time without time zone,uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_instructor_scheduling_request(
  uuid, uuid, text, integer, time without time zone, time without time zone,
  integer, integer, integer, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_instructor_scheduling_request(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_instructor_scheduling_requests(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_availability_readiness(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_instructor_availability_windows(
  uuid, uuid, text, integer, time without time zone, time without time zone, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_instructor_availability_enforcement(uuid, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public._ss_gather(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,
  time without time zone,time without time zone,uuid
) TO service_role;

COMMIT;
