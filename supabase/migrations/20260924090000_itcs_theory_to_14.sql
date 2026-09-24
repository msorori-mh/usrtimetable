-- ITCS: lecture rooms close at 14:00; only practical work may use labs to 16:00.
-- Keep the global 16:00 scheduling window for labs. Enforce the lecture
-- cutoff in the server conflict collector used by create, move, and relayout.
CREATE OR REPLACE FUNCTION public._ss_itcs_theory_hours(
  p_sid uuid, p_cid uuid, p_ta uuid, p_et time without time zone
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_et <= TIME '14:00' OR p_ta IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.colleges c
    JOIN public.teaching_assignments ta ON ta.college_id = c.id
    LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
    WHERE c.id = p_cid AND c.code = 'ITCS' AND ta.id = p_ta
      AND lower(coalesce(pcc.component_type, ta.session_type, '')) IN ('theory', 'tutorial', 'lecture')
  ) THEN
    RETURN jsonb_build_array(public._ss_ci(
      'itcs_theory_after_14', 'hard', p_sid, NULL,
      jsonb_build_object('end_time', p_et, 'cutoff', '14:00')
    ));
  END IF;
  RETURN '[]'::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public._ss_itcs_theory_hours(uuid, uuid, uuid, time without time zone)
  FROM PUBLIC, anon, authenticated;

-- Preserve the existing conflict collector's signature, privileges and every
-- prior check. A caller cannot bypass the time rule by choosing an open lab.
CREATE OR REPLACE FUNCTION public._ss_gather(
  a uuid, b uuid, c uuid, d uuid, e uuid, f uuid, g uuid,
  h text, i integer, j integer, k time without time zone,
  l time without time zone, m uuid
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
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
 ||COALESCE(public._ss_tmpl(a,b,h,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_set(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_brk(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_itcs_theory_hours(a,b,g,l),'[]'::jsonb);
$function$;

-- A hard operating-hours rule must not be converted into an approved exception.
ALTER TABLE public.schedule_version_conflict_exceptions
  ADD CONSTRAINT svce_no_itcs_theory_after_14
  CHECK (conflict_code <> 'itcs_theory_after_14');
