/**
 * Build Lovable-compatible compact conflict RPC migrations (<=1700 bytes each).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const migDir = path.join(root, "supabase", "migrations");
const parts = [];

function add(name, sql, meta) {
  parts.push({ name, sql: sql.trim() + "\n", ...meta });
}

function acl(sig) {
  return `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION ${sig} TO service_role;`;
}

add(
  "20260715012100_ss_conflict_item.sql",
  `CREATE OR REPLACE FUNCTION public._ss_ci(c text,s text,sid uuid,rid uuid,m jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT jsonb_build_object('code',c,'severity',s,'schedule_session_id',sid,'related_session_id',rid,'metadata',COALESCE(m,'{}'::jsonb));
$$;
${acl("public._ss_ci(text,text,uuid,uuid,jsonb)")}`,
  { creates: "_ss_ci", stop: "helper only", definer: "none", client: "none" },
);

add(
  "20260715012200_ss_time_overlap.sql",
  `CREATE OR REPLACE FUNCTION public._ss_ov(a time,b time,c time,d time)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT a < d AND c < b;
$$;
${acl("public._ss_ov(time,time,time,time)")}`,
  { creates: "_ss_ov", stop: "helper only", definer: "none", client: "none" },
);

add(
  "20260715012300_ss_session_subgroup.sql",
  `CREATE OR REPLACE FUNCTION public._ss_sg(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT section_subgroup_id FROM public.schedule_sessions WHERE id=p_id;
$$;
${acl("public._ss_sg(uuid)")}`,
  { creates: "_ss_sg", stop: "helper only", definer: "_ss_sg", client: "none" },
);

add(
  "20260715012400_ss_section_peer_hit.sql",
  `CREATE OR REPLACE FUNCTION public._ss_sec_hit(p_sec uuid,p_peer_sec uuid,p_sg uuid,p_peer_sg uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT p_sec IS NOT NULL AND p_peer_sec IS NOT NULL AND p_sec=p_peer_sec
  AND (p_peer_sg IS NULL OR p_sg IS NULL OR p_peer_sg=p_sg);
$$;
${acl("public._ss_sec_hit(uuid,uuid,uuid,uuid)")}`,
  { creates: "_ss_sec_hit", stop: "helper only", definer: "none", client: "none" },
);

add(
  "20260715012500_ss_enroll_trust.sql",
  `CREATE OR REPLACE FUNCTION public._ss_enroll(p_off uuid,p_exp integer, OUT n integer, OUT st text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  SELECT COALESCE(expected_students,0), COALESCE(enrollment_count_status,'unverified')
    INTO n,st FROM public.course_offerings WHERE id=p_off;
  IF COALESCE(p_exp,0)>0 THEN n:=p_exp; END IF;
  n:=COALESCE(n,0); st:=COALESCE(st,'unverified');
END;$$;
${acl("public._ss_enroll(uuid,integer)")}`,
  { creates: "_ss_enroll", stop: "helper only", definer: "_ss_enroll", client: "none" },
);

add(
  "20260715012600_ss_capacity_item.sql",
  `CREATE OR REPLACE FUNCTION public._ss_cap(sid uuid,st text,n integer,cap integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT CASE
 WHEN n>0 AND cap+5<n AND st='confirmed' THEN
  public._ss_ci('room_capacity','hard',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st))
 WHEN n>0 AND cap+5<n AND st IN ('estimated','unverified','test') THEN
  public._ss_ci('room_capacity_unverified','soft',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st,'blocking',false))
 ELSE NULL END;
$$;
${acl("public._ss_cap(uuid,text,integer,integer)")}`,
  { creates: "_ss_cap", stop: "helper only", definer: "none", client: "none" },
);

add(
  "20260715012700_ss_peer_instructor.sql",
  `CREATE OR REPLACE FUNCTION public._ss_peer_i(
  p_sid uuid,p_cid uuid,p_vid uuid,p_iid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; r record;
BEGIN
  FOR r IN
    SELECT id,instructor_id,day_of_week,start_time,end_time FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND instructor_id=p_iid AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et) THEN
      v:=v||jsonb_build_array(public._ss_ci('instructor_conflict','hard',p_sid,r.id,
        jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$$;
${acl("public._ss_peer_i(uuid,uuid,uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_peer_i", stop: "helper only", definer: "_ss_peer_i", client: "none" },
);

add(
  "20260715012800_ss_peer_room.sql",
  `CREATE OR REPLACE FUNCTION public._ss_peer_r(
  p_sid uuid,p_cid uuid,p_vid uuid,p_rid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; r record;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  FOR r IN
    SELECT id,room_id,day_of_week,start_time,end_time FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND room_id=p_rid AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et) THEN
      v:=v||jsonb_build_array(public._ss_ci('room_conflict','hard',p_sid,r.id,
        jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$$;
${acl("public._ss_peer_r(uuid,uuid,uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_peer_r", stop: "helper only", definer: "_ss_peer_r", client: "none" },
);

add(
  "20260715012900_ss_peer_section.sql",
  `CREATE OR REPLACE FUNCTION public._ss_peer_s(
  p_sid uuid,p_cid uuid,p_vid uuid,p_sec uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; r record; sg uuid;
BEGIN
  IF p_sec IS NULL THEN RETURN v; END IF;
  sg:=public._ss_sg(p_sid);
  FOR r IN
    SELECT id,section_id,section_subgroup_id,day_of_week,start_time,end_time
    FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND section_id=p_sec AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et)
       AND public._ss_sec_hit(p_sec,r.section_id,sg,r.section_subgroup_id) THEN
      v:=v||jsonb_build_array(public._ss_ci('section_conflict','hard',p_sid,r.id,
        jsonb_build_object('section_id',p_sec,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$$;
${acl("public._ss_peer_s(uuid,uuid,uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_peer_s", stop: "helper only", definer: "_ss_peer_s", client: "none" },
);

add(
  "20260715013000_ss_room_college_cap.sql",
  `CREATE OR REPLACE FUNCTION public._ss_room_cap(
  p_sid uuid,p_cid uuid,p_off uuid,p_exp integer,p_rid uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; rm record; n int; st text; item jsonb;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT id,capacity,college_id,is_active INTO rm FROM public.rooms WHERE id=p_rid;
  IF rm.id IS NULL OR rm.college_id<>p_cid OR COALESCE(rm.is_active,true)=false THEN
    RETURN v||jsonb_build_array(public._ss_ci('room_college_mismatch','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid)));
  END IF;
  SELECT * INTO n,st FROM public._ss_enroll(p_off,p_exp);
  item:=public._ss_cap(p_sid,st,n,rm.capacity);
  IF item IS NOT NULL THEN v:=v||jsonb_build_array(item); END IF;
  RETURN v;
END;$$;
${acl("public._ss_room_cap(uuid,uuid,uuid,integer,uuid)")}`,
  { creates: "_ss_room_cap", stop: "helper only", definer: "_ss_room_cap", client: "none" },
);

add(
  "20260715013100_ss_room_type.sql",
  `CREATE OR REPLACE FUNCTION public._ss_room_type(
  p_sid uuid,p_cid uuid,p_ta uuid,p_rid uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; req text; rtype text;
BEGIN
  IF p_rid IS NULL OR p_ta IS NULL THEN RETURN v; END IF;
  SELECT required_room_type INTO req FROM public.teaching_assignments
  WHERE id=p_ta AND college_id=p_cid;
  SELECT room_type INTO rtype FROM public.rooms WHERE id=p_rid;
  IF req IS NOT NULL AND rtype IS DISTINCT FROM req THEN
    v:=v||jsonb_build_array(public._ss_ci('room_type_mismatch','hard',p_sid,NULL,
      jsonb_build_object('required_room_type',req,'room_type',rtype,'room_id',p_rid,'teaching_assignment_id',p_ta)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_room_type(uuid,uuid,uuid,uuid)")}`,
  { creates: "_ss_room_type", stop: "helper only", definer: "_ss_room_type", client: "none" },
);

add(
  "20260715013200_ss_room_availability.sql",
  `CREATE OR REPLACE FUNCTION public._ss_room_av(
  p_sid uuid,p_cid uuid,p_rid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT COUNT(*) INTO cnt FROM public.room_availability
  WHERE room_id=p_rid AND day_of_week=p_dow AND college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.room_availability ra
    WHERE ra.room_id=p_rid AND ra.day_of_week=p_dow AND ra.college_id=p_cid
      AND p_st>=ra.start_time AND p_et<=ra.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('room_availability','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_room_av(uuid,uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_room_av", stop: "helper only", definer: "_ss_room_av", client: "none" },
);

add(
  "20260715013300_ss_instr_avail_required.sql",
  `CREATE OR REPLACE FUNCTION public._ss_iavail_req(
  p_sid uuid,p_cid uuid,p_iid uuid,p_dow integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; code text; ext boolean; req boolean; cnt int;
BEGIN
  SELECT it.code,it.is_external INTO code,ext
  FROM public.instructors i LEFT JOIN public.instructor_types it ON it.id=i.instructor_type_id
  WHERE i.id=p_iid;
  req:=(lower(COALESCE(code,''))='from_other_college' OR COALESCE(ext,false));
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 AND req THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability_required','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_iavail_req(uuid,uuid,uuid,integer)")}`,
  { creates: "_ss_iavail_req", stop: "helper only", definer: "_ss_iavail_req", client: "none" },
);

add(
  "20260715013400_ss_instr_avail_window.sql",
  `CREATE OR REPLACE FUNCTION public._ss_iavail_win(
  p_sid uuid,p_cid uuid,p_iid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean; blocked boolean;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type IS DISTINCT FROM 'unavailable'
      AND p_st>=ia.start_time AND p_et<=ia.end_time
  ) INTO fits;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type='unavailable'
      AND ia.start_time<p_et AND p_st<ia.end_time
  ) INTO blocked;
  IF (NOT fits) OR blocked THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_iavail_win(uuid,uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_iavail_win", stop: "helper only", definer: "_ss_iavail_win", client: "none" },
);

add(
  "20260715013500_ss_template_conflicts.sql",
  `CREATE OR REPLACE FUNCTION public._ss_tmpl(
  p_sid uuid,p_cid uuid,p_sys text,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.time_slot_templates tt
  WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
    AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both');
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.time_slot_templates tt
    WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
      AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both')
      AND p_st>=tt.start_time AND p_et<=tt.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('study_system_time_template','hard',p_sid,NULL,
      jsonb_build_object('study_system',p_sys,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_tmpl(uuid,uuid,text,integer,time,time)")}`,
  { creates: "_ss_tmpl", stop: "helper only", definer: "_ss_tmpl", client: "none" },
);

add(
  "20260715013600_ss_settings_conflicts.sql",
  `CREATE OR REPLACE FUNCTION public._ss_set(
  p_sid uuid,p_cid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; s record;
BEGIN
  SELECT working_days,day_start_time,day_end_time INTO s
  FROM public.scheduling_settings WHERE college_id=p_cid LIMIT 1;
  IF s.working_days IS NOT NULL AND cardinality(s.working_days)>0 AND NOT (p_dow=ANY(s.working_days)) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_days','hard',p_sid,NULL,
      jsonb_build_object('day_of_week',p_dow)));
  END IF;
  IF s.day_start_time IS NOT NULL AND s.day_end_time IS NOT NULL
     AND (p_st<s.day_start_time OR p_et>s.day_end_time) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_hours','hard',p_sid,NULL,
      jsonb_build_object('day_start_time',s.day_start_time,'day_end_time',s.day_end_time)));
  END IF;
  RETURN v;
END;$$;
${acl("public._ss_set(uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_set", stop: "helper only", definer: "_ss_set", client: "none" },
);

add(
  "20260715013700_ss_break_conflicts.sql",
  `CREATE OR REPLACE FUNCTION public._ss_brk(
  p_sid uuid,p_cid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; b record;
BEGIN
  FOR b IN
    SELECT id,name FROM public.daily_breaks
    WHERE college_id=p_cid AND affects_scheduling
      AND p_dow=ANY(days) AND start_time<p_et AND p_st<end_time
  LOOP
    v:=v||jsonb_build_array(public._ss_ci('daily_break','hard',p_sid,NULL,
      jsonb_build_object('daily_break_id',b.id,'name',b.name)));
  END LOOP;
  RETURN v;
END;$$;
${acl("public._ss_brk(uuid,uuid,integer,time,time)")}`,
  { creates: "_ss_brk", stop: "helper only", definer: "_ss_brk", client: "none" },
);

add(
  "20260715013800_ss_exception_match.sql",
  `CREATE OR REPLACE FUNCTION public._ss_ex_match(
  p_vid uuid,p_code text,p_sid uuid,p_rid uuid, OUT ok boolean, OUT eid uuid, OUT ereas text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  ok:=false; eid:=NULL; ereas:=NULL;
  IF p_sid IS NULL THEN RETURN; END IF;
  IF p_rid IS NULL THEN
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND session_id=p_sid AND related_session_id IS NULL LIMIT 1;
  ELSE
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND related_session_id IS NOT NULL
      AND LEAST(session_id,related_session_id)=LEAST(p_sid,p_rid)
      AND GREATEST(session_id,related_session_id)=GREATEST(p_sid,p_rid) LIMIT 1;
  END IF;
  IF FOUND THEN ok:=true; ELSE eid:=NULL; ereas:=NULL; END IF;
END;$$;
${acl("public._ss_ex_match(uuid,text,uuid,uuid)")}`,
  { creates: "_ss_ex_match", stop: "helper only", definer: "_ss_ex_match", client: "none" },
);

add(
  "20260715013900_ss_pack_exceptions.sql",
  `CREATE OR REPLACE FUNCTION public._ss_pack(p_conflicts jsonb,p_vid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; item jsonb; enr jsonb:='[]'::jsonb; blk jsonb:='[]'::jsonb;
  appr jsonb:='[]'::jsonb; warn jsonb:='[]'::jsonb; ok boolean; eid uuid; ereas text;
  prim uuid; sec uuid;
BEGIN
  FOR c IN SELECT elem FROM jsonb_array_elements(COALESCE(p_conflicts,'[]'::jsonb)) t(elem)
  LOOP
    prim:=NULLIF(c->>'schedule_session_id','')::uuid;
    sec:=CASE WHEN c->>'related_session_id' IS NULL OR c->>'related_session_id'='null' THEN NULL
      ELSE (c->>'related_session_id')::uuid END;
    SELECT * INTO ok,eid,ereas FROM public._ss_ex_match(p_vid,c->>'code',prim,sec);
    item:=c||jsonb_build_object('approved_exception',ok,'exception_id',eid,'exception_reason',ereas);
    enr:=enr||jsonb_build_array(item);
    IF COALESCE(c->>'severity','hard')='soft' THEN warn:=warn||jsonb_build_array(item);
    ELSIF ok THEN appr:=appr||jsonb_build_array(item);
    ELSE blk:=blk||jsonb_build_array(item); END IF;
  END LOOP;
  RETURN jsonb_build_object('all_conflicts',enr,'blocking_conflicts',blk,
    'approved_exceptions',appr,'warnings',warn);
END;$$;
${acl("public._ss_pack(jsonb,uuid)")}`,
  { creates: "_ss_pack", stop: "helper only", definer: "_ss_pack", client: "none" },
);

add(
  "20260715014000_ss_gather_conflicts.sql",
  `CREATE OR REPLACE FUNCTION public._ss_gather(
  a uuid,b uuid,c uuid,d uuid,e uuid,f uuid,g uuid,h text,i integer,j integer,k time,l time,m uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
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
 ||COALESCE(public._ss_brk(a,b,j,k,l),'[]'::jsonb);
$$;
${acl("public._ss_gather(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time,time,uuid)")}`,
  { creates: "_ss_gather", stop: "helper only", definer: "_ss_gather", client: "none" },
);

add(
  "20260715014100_ss_collect_replace.sql",
  `CREATE OR REPLACE FUNCTION public._collect_schedule_session_move_conflicts(
  p_session_id uuid,p_college_id uuid,p_version_id uuid,p_instructor_id uuid,
  p_section_id uuid,p_course_offering_id uuid,p_teaching_assignment_id uuid,
  p_study_system text,p_expected_students integer,p_day_of_week integer,
  p_start_time time,p_end_time time,p_room_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT public._ss_pack(
  public._ss_gather(
    p_session_id,p_college_id,p_version_id,p_instructor_id,p_section_id,
    p_course_offering_id,p_teaching_assignment_id,p_study_system,p_expected_students,
    p_day_of_week,p_start_time,p_end_time,p_room_id
  ),
  p_version_id
);
$$;
${acl("public._collect_schedule_session_move_conflicts(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time,time,uuid)")}`,
  {
    creates: "_collect_schedule_session_move_conflicts",
    stop: "collector live; wrappers use new behavior",
    definer: "_collect_schedule_session_move_conflicts",
    client: "none",
  },
);

// cleanup old oversized names if any + 30100
for (const f of fs.readdirSync(migDir)) {
  if (/^2026071501(2[1-9]|3\d|4\d)/.test(f) || f.includes("30100_section_subgroups_conflict")) {
    fs.unlinkSync(path.join(migDir, f));
  }
}

const rows = [
  "migration_filename,apply_order,file_size,sha256,creates_or_replaces,safe_stop_after_apply,contains_data_apply,security_definer_functions,client_executable_functions",
];
let order = 1;
let max = 0;
const overs = [];

for (const p of parts) {
  const fp = path.join(migDir, p.name);
  const buf = Buffer.from(p.sql, "utf8");
  fs.writeFileSync(fp, buf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  max = Math.max(max, buf.length);
  if (buf.length > 1700) overs.push(`${p.name}=${buf.length}`);
  if (/[\u0600-\u06FF]/.test(p.sql)) overs.push(`${p.name}:arabic`);
  if (/message_ar|message_en/.test(p.sql)) overs.push(`${p.name}:message_literals`);
  if (/INSERT\s+INTO\s+public\.(section_subgroups|schedule_sessions|rooms)/i.test(p.sql)) {
    overs.push(`${p.name}:data_apply`);
  }
  rows.push(
    [p.name, order++, buf.length, sha, p.creates, `"${p.stop}"`, "NO", p.definer, p.client].join(","),
  );
  console.log(String(buf.length).padStart(4), p.name);
}

console.log("max", max, "count", parts.length);
if (overs.length) {
  console.error("FAIL", overs);
  process.exit(1);
}

const reportDir = path.join(
  root,
  "implementation-reports/phase-6-conflict-rpc-tooling-compatible-refactor-01",
);
const exp = path.join(reportDir, "lovable-compact-migration-exports");
fs.mkdirSync(exp, { recursive: true });
fs.writeFileSync(path.join(reportDir, "compact-migration-manifest.csv"), rows.join("\n") + "\n");
for (const p of parts) {
  fs.copyFileSync(path.join(migDir, p.name), path.join(exp, p.name));
}
const schema = "20260715012000_section_subgroups_capacity_model.sql";
fs.copyFileSync(path.join(migDir, schema), path.join(exp, schema));
console.log("PASS");
