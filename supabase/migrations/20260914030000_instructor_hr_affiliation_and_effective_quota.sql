-- INSTRUCTOR-HR-AFFILIATION-01
-- Separate HR affiliation from operational scheduling ownership and make the
-- applied weekly quota = base quota - administrative release without rewriting base data.

ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS affiliation_college_id uuid,
  ADD COLUMN IF NOT EXISTS affiliation_department_id uuid,
  ADD COLUMN IF NOT EXISTS administrative_position text,
  ADD COLUMN IF NOT EXISTS administrative_department_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_affiliation_college_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_affiliation_college_fkey
      FOREIGN KEY (affiliation_college_id) REFERENCES public.colleges(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_affiliation_department_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_affiliation_department_fkey
      FOREIGN KEY (affiliation_department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_administrative_department_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_administrative_department_fkey
      FOREIGN KEY (administrative_department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_administrative_position_check') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_administrative_position_check CHECK (
      administrative_position IS NULL OR administrative_position IN (
        'department_head','vice_dean_academic','vice_dean_student_affairs','dean'
      )
    );
  END IF;
END $$;

UPDATE public.instructors
SET affiliation_college_id = COALESCE(affiliation_college_id, college_id),
    affiliation_department_id = COALESCE(affiliation_department_id, department_id)
WHERE affiliation_college_id IS NULL OR affiliation_department_id IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_instructor_hr_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_dep_college uuid;
  v_admin_dep_college uuid;
  v_type_code text;
BEGIN
  NEW.affiliation_college_id := COALESCE(NEW.affiliation_college_id, NEW.college_id);
  NEW.affiliation_department_id := COALESCE(NEW.affiliation_department_id, NEW.department_id);

  IF NEW.affiliation_department_id IS NOT NULL THEN
    SELECT college_id INTO v_dep_college FROM public.departments WHERE id=NEW.affiliation_department_id;
    IF v_dep_college IS NULL OR v_dep_college <> NEW.affiliation_college_id THEN
      RAISE EXCEPTION 'affiliation_department_id must belong to affiliation_college_id';
    END IF;
  END IF;

  IF NEW.administrative_position = 'department_head' THEN
    IF NEW.administrative_department_id IS NULL THEN
      RAISE EXCEPTION 'administrative_department_id is required for department_head';
    END IF;
    SELECT college_id INTO v_admin_dep_college FROM public.departments WHERE id=NEW.administrative_department_id;
    IF v_admin_dep_college IS NULL OR v_admin_dep_college <> NEW.affiliation_college_id THEN
      RAISE EXCEPTION 'administrative department must belong to affiliation college';
    END IF;
  ELSE
    NEW.administrative_department_id := NULL;
  END IF;

  IF NEW.instructor_type_id IS NOT NULL THEN
    SELECT lower(code) INTO v_type_code FROM public.instructor_types WHERE id=NEW.instructor_type_id;
    IF COALESCE(v_type_code,'')='con' THEN
      NEW.administrative_release_hours := 0;
      NEW.administrative_position := NULL;
      NEW.administrative_department_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_instructors_hr_affiliation ON public.instructors;
CREATE TRIGGER trg_instructors_hr_affiliation
BEFORE INSERT OR UPDATE ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_hr_affiliation();

CREATE OR REPLACE FUNCTION public._import_apply_table_entity(
  p_college uuid,
  p_entity text,
  p_mode text,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v_elem jsonb;
  v jsonb;
  v_rn int;
  v_uniq text;
  v_name_matches int;
  v_type_code text;
  v_aff_college uuid;
  v_aff_department uuid;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_counters jsonb := public._import_counters_new();
  v_ins int := 0;
  v_upd int := 0;
  v_skp int := 0;
BEGIN
  -- Phase 1: pre-validate ALL rows before any operational DML.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF p_entity = 'instructors' THEN
      IF NULLIF(v->>'full_name', '') IS NULL THEN
        RAISE EXCEPTION 'instructors row % missing full_name', v_rn USING ERRCODE = '22023';
      END IF;
      v_aff_college := COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college);
      v_aff_department := COALESCE(
        NULLIF(v->>'_affiliation_department_id', '')::uuid,
        NULLIF(v->>'_department_id', '')::uuid
      );
      IF NULLIF(v->>'employee_number', '') IS NULL THEN
        SELECT lower(code) INTO v_type_code
        FROM public.instructor_types
        WHERE id = NULLIF(v->>'_instructor_type_id', '')::uuid;
        IF COALESCE(v_type_code, '') <> 'con' THEN
          RAISE EXCEPTION 'instructors row % missing employee_number for non-con category', v_rn USING ERRCODE = '22023';
        END IF;
        SELECT count(*) INTO v_name_matches
        FROM public.instructors i
        WHERE i.college_id = p_college
          AND (lower(btrim(i.full_name)) = lower(btrim(v->>'full_name'))
            OR lower(btrim(COALESCE(i.full_name_ar, ''))) = lower(btrim(v->>'full_name')))
          AND COALESCE(i.affiliation_college_id, i.college_id) = v_aff_college
          AND (v_aff_department IS NULL OR COALESCE(i.affiliation_department_id, i.department_id) = v_aff_department);
        IF v_name_matches > 1 THEN
          RAISE EXCEPTION 'instructors row % ambiguous name match without employee_number', v_rn USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSIF p_entity = 'rooms' THEN
      IF NULLIF(v->>'code', '') IS NULL OR NULLIF(v->>'name', '') IS NULL OR NULLIF(v->>'room_type', '') IS NULL THEN
        RAISE EXCEPTION 'rooms row % missing code/name/room_type', v_rn USING ERRCODE = '22023';
      END IF;
    ELSIF p_entity = 'academic_terms' THEN
      IF NULLIF(v->>'code', '') IS NULL OR NULLIF(v->>'name', '') IS NULL THEN
        RAISE EXCEPTION 'academic_terms row % missing code/name', v_rn USING ERRCODE = '22023';
      END IF;
    ELSIF p_entity = 'daily_breaks' THEN
      IF NULLIF(v->>'name', '') IS NULL OR NULLIF(v->>'start_time', '') IS NULL OR NULLIF(v->>'end_time', '') IS NULL THEN
        RAISE EXCEPTION 'daily_breaks row % missing name/start_time/end_time', v_rn USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported table entity: %', p_entity USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Phase 2: apply. Existing target rows are locked (id ASC) before writes.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;

    IF p_entity = 'instructors' THEN
      v_uniq := NULLIF(v->>'employee_number', '');
      v_aff_college := COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college);
      v_aff_department := COALESCE(
        NULLIF(v->>'_affiliation_department_id', '')::uuid,
        NULLIF(v->>'_department_id', '')::uuid
      );
      IF v_uniq IS NOT NULL THEN
        SELECT id INTO v_id FROM public.instructors
          WHERE college_id = p_college AND lower(employee_number) = lower(v_uniq)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      ELSE
        SELECT id INTO v_id FROM public.instructors i
          WHERE i.college_id = p_college
            AND (lower(btrim(i.full_name)) = lower(btrim(v->>'full_name'))
              OR lower(btrim(COALESCE(i.full_name_ar, ''))) = lower(btrim(v->>'full_name')))
            AND COALESCE(i.affiliation_college_id, i.college_id) = v_aff_college
            AND (v_aff_department IS NULL OR COALESCE(i.affiliation_department_id, i.department_id) = v_aff_department)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      END IF;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.instructors (
          college_id, employee_number, full_name, full_name_ar, full_name_en, email, phone,
          specialization, academic_degree, academic_rank, instructor_type_id, department_id,
          employment_type, max_weekly_hours, max_hours_per_day, administrative_release_hours,
          admin_tasks, external_source, notes, is_active,
          affiliation_college_id, affiliation_department_id,
          administrative_position, administrative_department_id
        ) VALUES (
          p_college, NULLIF(v->>'employee_number', ''), v->>'full_name',
          COALESCE(NULLIF(v->>'full_name_ar', ''), v->>'full_name'),
          NULLIF(v->>'full_name_en', ''), NULLIF(v->>'email', ''), NULLIF(v->>'phone', ''),
          NULLIF(v->>'specialization', ''), NULLIF(v->>'academic_degree', ''),
          NULLIF(v->>'academic_rank', ''),
          NULLIF(v->>'_instructor_type_id', '')::uuid, NULLIF(v->>'_department_id', '')::uuid,
          COALESCE(NULLIF(v->>'employment_type', ''), 'full_time'),
          COALESCE(NULLIF(v->>'max_weekly_hours', '')::numeric, 18),
          NULLIF(v->>'max_hours_per_day', '')::numeric,
          COALESCE(NULLIF(v->>'administrative_release_hours', '')::numeric, 0),
          NULLIF(v->>'admin_tasks', ''), NULLIF(v->>'external_source', ''), NULLIF(v->>'notes', ''),
          COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
          COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college),
          COALESCE(NULLIF(v->>'_affiliation_department_id', '')::uuid, NULLIF(v->>'_department_id', '')::uuid),
          NULLIF(v->>'administrative_position', ''),
          NULLIF(v->>'_administrative_department_id', '')::uuid
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.instructors SET
          full_name = v->>'full_name',
          full_name_ar = COALESCE(NULLIF(v->>'full_name_ar', ''), v->>'full_name'),
          full_name_en = NULLIF(v->>'full_name_en', ''),
          email = NULLIF(v->>'email', ''),
          phone = NULLIF(v->>'phone', ''),
          specialization = NULLIF(v->>'specialization', ''),
          academic_degree = NULLIF(v->>'academic_degree', ''),
          academic_rank = NULLIF(v->>'academic_rank', ''),
          instructor_type_id = NULLIF(v->>'_instructor_type_id', '')::uuid,
          department_id = NULLIF(v->>'_department_id', '')::uuid,
          employment_type = COALESCE(NULLIF(v->>'employment_type', ''), 'full_time'),
          max_weekly_hours = COALESCE(NULLIF(v->>'max_weekly_hours', '')::numeric, 18),
          max_hours_per_day = NULLIF(v->>'max_hours_per_day', '')::numeric,
          administrative_release_hours = COALESCE(NULLIF(v->>'administrative_release_hours', '')::numeric, 0),
          admin_tasks = COALESCE(NULLIF(v->>'admin_tasks', ''), instructors.admin_tasks),
          external_source = COALESCE(NULLIF(v->>'external_source', ''), instructors.external_source),
          notes = COALESCE(NULLIF(v->>'notes', ''), instructors.notes),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
          employee_number = COALESCE(NULLIF(v->>'employee_number', ''), instructors.employee_number),
          affiliation_college_id = COALESCE(
            NULLIF(v->>'_affiliation_college_id', '')::uuid, instructors.affiliation_college_id, p_college),
          affiliation_department_id = COALESCE(
            NULLIF(v->>'_affiliation_department_id', '')::uuid, instructors.affiliation_department_id),
          administrative_position = NULLIF(v->>'administrative_position', ''),
          administrative_department_id = NULLIF(v->>'_administrative_department_id', '')::uuid
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'rooms' THEN
      v_uniq := v->>'code';
      SELECT id INTO v_id FROM public.rooms
        WHERE college_id = p_college AND lower(code) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.rooms (
          college_id, code, name, capacity, room_type, room_type_id, building_id, building,
          floor, available_start_time, available_end_time, notes, is_active
        ) VALUES (
          p_college, v->>'code', v->>'name',
          COALESCE(NULLIF(v->>'capacity', '')::int, 30), v->>'room_type',
          NULLIF(v->>'_room_type_id', '')::uuid, NULLIF(v->>'_building_id', '')::uuid,
          NULLIF(v->>'building', ''), NULLIF(v->>'floor', ''),
          NULLIF(v->>'available_start_time', '')::time, NULLIF(v->>'available_end_time', '')::time,
          NULLIF(v->>'notes', ''), COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.rooms SET
          name = v->>'name',
          capacity = COALESCE(NULLIF(v->>'capacity', '')::int, 30),
          room_type = v->>'room_type',
          room_type_id = NULLIF(v->>'_room_type_id', '')::uuid,
          building_id = NULLIF(v->>'_building_id', '')::uuid,
          building = NULLIF(v->>'building', ''),
          floor = NULLIF(v->>'floor', ''),
          available_start_time = NULLIF(v->>'available_start_time', '')::time,
          available_end_time = NULLIF(v->>'available_end_time', '')::time,
          notes = NULLIF(v->>'notes', ''),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'academic_terms' THEN
      v_uniq := v->>'code';
      SELECT id INTO v_id FROM public.academic_terms
        WHERE college_id = p_college AND lower(code) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.academic_terms (
          college_id, code, name, academic_year, term_type, start_date, end_date,
          teaching_weeks_count, is_active
        ) VALUES (
          p_college, v->>'code', v->>'name', NULLIF(v->>'academic_year', ''),
          NULLIF(v->>'term_type', ''), NULLIF(v->>'start_date', '')::date,
          NULLIF(v->>'end_date', '')::date, NULLIF(v->>'teaching_weeks_count', '')::int,
          COALESCE(NULLIF(v->>'is_active', '')::boolean, false)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.academic_terms SET
          name = v->>'name',
          academic_year = NULLIF(v->>'academic_year', ''),
          term_type = NULLIF(v->>'term_type', ''),
          start_date = NULLIF(v->>'start_date', '')::date,
          end_date = NULLIF(v->>'end_date', '')::date,
          teaching_weeks_count = NULLIF(v->>'teaching_weeks_count', '')::int,
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, false)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'daily_breaks' THEN
      v_uniq := v->>'name';
      SELECT id INTO v_id FROM public.daily_breaks
        WHERE college_id = p_college AND lower(name) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.daily_breaks (
          college_id, name, start_time, end_time, days, affects_scheduling
        ) VALUES (
          p_college, v->>'name', (v->>'start_time')::time, (v->>'end_time')::time,
          CASE WHEN jsonb_typeof(v->'days') = 'array'
               THEN ARRAY(SELECT (e)::int FROM jsonb_array_elements_text(v->'days') e)
               ELSE ARRAY[]::int[] END,
          COALESCE(NULLIF(v->>'affects_scheduling', '')::boolean, true)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.daily_breaks SET
          start_time = (v->>'start_time')::time,
          end_time = (v->>'end_time')::time,
          days = CASE WHEN jsonb_typeof(v->'days') = 'array'
                      THEN ARRAY(SELECT (e)::int FROM jsonb_array_elements_text(v->'days') e)
                      ELSE ARRAY[]::int[] END,
          affects_scheduling = COALESCE(NULLIF(v->>'affects_scheduling', '')::boolean, true)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;
