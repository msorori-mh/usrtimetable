-- Keep large-theory capacity overrides and derived delivery-group capacities
-- synchronized with the actual largest active lecture hall in each college.
-- This prevents stale historical capacities (for example an old grand-hall size)
-- from surviving after room capacity changes.

CREATE OR REPLACE FUNCTION public.guard_shared_lecture_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_explicit integer;
BEGIN
  IF EXISTS(
    SELECT 1 FROM public.shared_lecture_links
    WHERE anchor_group_id=OLD.id OR member_group_id=OLD.id
  ) THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514';
    END IF;

    IF NEW.cohort_id IS DISTINCT FROM OLD.cohort_id
       OR NEW.component_id IS DISTINCT FROM OLD.component_id
       OR NEW.plan_course_id IS DISTINCT FROM OLD.plan_course_id
       OR NEW.college_id IS DISTINCT FROM OLD.college_id
       OR NEW.expected_students IS DISTINCT FROM OLD.expected_students
       OR NEW.capacity_limit IS DISTINCT FROM OLD.capacity_limit
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.is_obsolete IS DISTINCT FROM OLD.is_obsolete THEN

      SELECT pcc.explicit_group_size INTO v_explicit
      FROM public.plan_course_components pcc
      WHERE pcc.id=NEW.component_id AND pcc.college_id=NEW.college_id;

      -- Capacity-only changes are allowed when they come from the component's
      -- explicit, managed large-theory capacity source. All other structural
      -- changes remain protected by the shared-lecture review guard.
      IF NEW.cohort_id IS NOT DISTINCT FROM OLD.cohort_id
         AND NEW.component_id IS NOT DISTINCT FROM OLD.component_id
         AND NEW.plan_course_id IS NOT DISTINCT FROM OLD.plan_course_id
         AND NEW.college_id IS NOT DISTINCT FROM OLD.college_id
         AND NEW.expected_students IS NOT DISTINCT FROM OLD.expected_students
         AND NEW.active IS NOT DISTINCT FROM OLD.active
         AND NEW.is_obsolete IS NOT DISTINCT FROM OLD.is_obsolete
         AND NEW.capacity_limit IS DISTINCT FROM OLD.capacity_limit
         AND v_explicit IS NOT NULL
         AND v_explicit > 0
         AND NEW.capacity_limit = v_explicit THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_theory_delivery_group_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_type text;
  v_explicit integer;
  v_default integer;
BEGIN
  SELECT pcc.component_type, pcc.explicit_group_size, rt.default_capacity
  INTO v_type, v_explicit, v_default
  FROM public.plan_course_components pcc
  LEFT JOIN public.room_types rt
    ON rt.id=pcc.required_room_type_id
   AND rt.college_id=pcc.college_id
  WHERE pcc.id=NEW.component_id AND pcc.college_id=NEW.college_id;

  IF v_type='theory'
     AND v_explicit IS NOT NULL
     AND v_explicit > COALESCE(v_default,0) THEN
    NEW.capacity_limit := v_explicit;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aaa_dg_capacity_from_component ON public.delivery_groups;
CREATE TRIGGER aaa_dg_capacity_from_component
BEFORE INSERT OR UPDATE OF component_id, capacity_limit ON public.delivery_groups
FOR EACH ROW EXECUTE FUNCTION public.normalize_theory_delivery_group_capacity();

CREATE OR REPLACE FUNCTION public.propagate_theory_explicit_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_default integer;
BEGIN
  IF NEW.component_type <> 'theory'
     OR NEW.explicit_group_size IS NOT DISTINCT FROM OLD.explicit_group_size THEN
    RETURN NULL;
  END IF;

  SELECT rt.default_capacity INTO v_default
  FROM public.room_types rt
  WHERE rt.id=NEW.required_room_type_id AND rt.college_id=NEW.college_id;

  IF NEW.explicit_group_size IS NOT NULL
     AND NEW.explicit_group_size > COALESCE(v_default,0) THEN
    UPDATE public.delivery_groups dg
    SET capacity_limit=NEW.explicit_group_size,
        updated_at=now()
    WHERE dg.college_id=NEW.college_id
      AND dg.component_id=NEW.id
      AND dg.capacity_limit IS DISTINCT FROM NEW.explicit_group_size;
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pcc_propagate_theory_capacity ON public.plan_course_components;
CREATE TRIGGER trg_pcc_propagate_theory_capacity
AFTER UPDATE OF explicit_group_size ON public.plan_course_components
FOR EACH ROW EXECUTE FUNCTION public.propagate_theory_explicit_capacity();

CREATE OR REPLACE FUNCTION public.sync_large_theory_capacity_from_rooms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_college uuid := COALESCE(NEW.college_id, OLD.college_id);
  v_room_type_id uuid;
  v_default integer;
  v_max integer;
BEGIN
  SELECT rt.id, rt.default_capacity
  INTO v_room_type_id, v_default
  FROM public.room_types rt
  WHERE rt.college_id=v_college
    AND rt.code='lecture_hall'
    AND rt.is_active
  ORDER BY rt.updated_at DESC, rt.id
  LIMIT 1;

  IF v_room_type_id IS NULL OR v_default IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT max(r.capacity) INTO v_max
  FROM public.rooms r
  WHERE r.college_id=v_college
    AND r.is_active
    AND r.room_type='lecture_hall'
    AND r.capacity IS NOT NULL
    AND r.capacity > 0;

  IF v_max IS NULL OR v_max <= v_default THEN
    RETURN NULL;
  END IF;

  UPDATE public.plan_course_components pcc
  SET explicit_group_size=v_max,
      updated_at=now()
  WHERE pcc.college_id=v_college
    AND pcc.component_type='theory'
    AND pcc.required_room_type_id=v_room_type_id
    AND pcc.explicit_group_size IS NOT NULL
    AND pcc.explicit_group_size > v_default
    AND pcc.explicit_group_size IS DISTINCT FROM v_max;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rooms_sync_large_theory_capacity ON public.rooms;
CREATE TRIGGER trg_rooms_sync_large_theory_capacity
AFTER INSERT OR UPDATE OR DELETE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.sync_large_theory_capacity_from_rooms();

-- Reconcile existing managed large-theory overrides with the actual room source.
WITH cfg AS (
  SELECT c.id AS college_id,
         rt.id AS room_type_id,
         rt.default_capacity,
         (SELECT max(r.capacity)
          FROM public.rooms r
          WHERE r.college_id=c.id
            AND r.is_active
            AND r.room_type='lecture_hall'
            AND r.capacity>0) AS max_capacity
  FROM public.colleges c
  JOIN public.room_types rt
    ON rt.college_id=c.id
   AND rt.code='lecture_hall'
   AND rt.is_active
)
UPDATE public.plan_course_components pcc
SET explicit_group_size=cfg.max_capacity,
    updated_at=now()
FROM cfg
WHERE pcc.college_id=cfg.college_id
  AND pcc.required_room_type_id=cfg.room_type_id
  AND pcc.component_type='theory'
  AND pcc.explicit_group_size IS NOT NULL
  AND pcc.explicit_group_size > cfg.default_capacity
  AND cfg.max_capacity IS NOT NULL
  AND pcc.explicit_group_size IS DISTINCT FROM cfg.max_capacity;

-- Clean impossible stale derived theory capacities above the largest active hall.
WITH cfg AS (
  SELECT c.id AS college_id,
         rt.default_capacity,
         (SELECT max(r.capacity)
          FROM public.rooms r
          WHERE r.college_id=c.id
            AND r.is_active
            AND r.room_type='lecture_hall'
            AND r.capacity>0) AS max_capacity
  FROM public.colleges c
  JOIN public.room_types rt
    ON rt.college_id=c.id
   AND rt.code='lecture_hall'
   AND rt.is_active
)
UPDATE public.delivery_groups dg
SET capacity_limit = CASE
  WHEN pcc.explicit_group_size IS NOT NULL
       AND pcc.explicit_group_size > cfg.default_capacity
    THEN pcc.explicit_group_size
  WHEN dg.expected_students > cfg.default_capacity
    THEN cfg.max_capacity
  ELSE cfg.default_capacity
END,
updated_at=now()
FROM public.plan_course_components pcc, cfg
WHERE dg.college_id=cfg.college_id
  AND dg.component_id=pcc.id
  AND pcc.component_type='theory'
  AND cfg.max_capacity IS NOT NULL
  AND dg.capacity_limit > cfg.max_capacity;
