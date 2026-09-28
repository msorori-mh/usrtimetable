import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rev2 = fs.readFileSync(
  "supabase/migrations/20260928082000_version_scoped_assignments.sql",
  "utf8",
);
const fn = (name) => {
  const m = rev2.match(
    new RegExp(
      "^CREATE FUNCTION " + name.replaceAll(".", "\\.") + "\\([\\s\\S]*?^(?:END )?\\$\\$;\\n",
      "m",
    ),
  );
  assert.ok(m, name);
  return m[0];
};
const setup = `
CREATE SCHEMA auth; CREATE SCHEMA faculty_private; CREATE SCHEMA assignment_version_private; CREATE SCHEMA itcs_cutover_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public.is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${id(1)}'::uuid $$;
CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.is_super_admin(u) $$;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid,status text);
CREATE TABLE public.instructors(id uuid PRIMARY KEY,full_name text);
CREATE TABLE public.faculty_identity_links(instructor_id uuid,identity_id uuid);
CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY,component_type text,weekly_contact_hours numeric);
CREATE TABLE public.academic_cohorts(id uuid PRIMARY KEY,code text,term_id uuid);
CREATE TABLE public.plan_courses(id uuid PRIMARY KEY,course_id uuid);
CREATE TABLE public.courses(id uuid PRIMARY KEY,code text,name text);
CREATE TABLE public.delivery_groups(id uuid PRIMARY KEY,cohort_id uuid,plan_course_id uuid,component_id uuid,college_id uuid,active boolean DEFAULT true,is_obsolete boolean DEFAULT false);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,course_offering_id uuid,instructor_id uuid,
 section_number text,session_type text,weekly_hours numeric,required_room_type text,notes text,expected_students integer,section_id uuid,cohort_id uuid,
 plan_course_component_id uuid,delivery_group_id uuid,assigned_component_hours numeric,is_active boolean DEFAULT true);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),schedule_version_id uuid,teaching_assignment_id uuid,instructor_id uuid,
 day_of_week smallint,start_time time,end_time time,room_id uuid,delivery_group_id uuid,cohort_id uuid);
CREATE TABLE public.faculty_teaching_requests(id uuid PRIMARY KEY,delivery_group_id uuid,instructor_id uuid,college_id uuid,assigned_hours numeric,
 status text DEFAULT 'pending',assignment_id uuid,decided_by uuid,decided_at timestamptz);
CREATE TABLE assignment_version_private.scope(assignment_id uuid PRIMARY KEY REFERENCES public.teaching_assignments(id) DEFERRABLE INITIALLY DEFERRED,
 version_id uuid,replaces_assignment_id uuid,request_id uuid,created_by uuid);
CREATE TABLE assignment_version_private.enabled_versions(version_id uuid PRIMARY KEY);
CREATE TABLE assignment_version_private.request_scope(request_id uuid PRIMARY KEY,version_id uuid,replaces_assignment_id uuid);
CREATE TABLE public.audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
CREATE FUNCTION assignment_version_private.is_counted(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT NOT EXISTS(SELECT 1 FROM assignment_version_private.scope WHERE assignment_id=a) $$;
CREATE FUNCTION assignment_version_private.assert_projected_load(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(ta.id) FROM public.teaching_assignments ta
    WHERE ta.is_active = true
 $$;
CREATE FUNCTION public.guard_version_scoped_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM assignment_version_private.assert_projected_load(NEW.id);
 RETURN NEW; END $$;
CREATE FUNCTION itcs_cutover_private.assert_history(m jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE h text; BEGIN
 SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}';
 IF h IS DISTINCT FROM m->>'history_hash' THEN RAISE EXCEPTION 'HISTORY_CHANGED'; END IF;
 END $$;
CREATE FUNCTION itcs_cutover_private.replacement_status(v uuid,m jsonb)
RETURNS TABLE(replaces uuid,scoped_request uuid,state text) LANGUAGE sql AS $$
 SELECT r.replaces_assignment_id,r.request_id,
 CASE WHEN f.status='pending' THEN 'awaiting_home_decision' WHEN f.status='approved' AND s.assignment_id IS NOT NULL THEN 'applied' ELSE 'invalid' END
 FROM assignment_version_private.request_scope r JOIN public.faculty_teaching_requests f ON f.id=r.request_id
 LEFT JOIN assignment_version_private.scope s ON s.request_id=r.request_id WHERE r.version_id=v $$;
CREATE FUNCTION public.itcs_cutover_preview(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v_uid uuid:=auth.uid();v_ver public.schedule_versions%ROWTYPE;v_out jsonb:='[]';v_prev jsonb;z record; BEGIN
 IF NOT coalesce(public.is_super_admin(v_uid),false) THEN RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED'; END IF;
 IF p_stage NOT IN ('requests', 'apply', 'publish') THEN RAISE EXCEPTION 'INVALID_STAGE'; END IF;
 SELECT * INTO v_ver FROM public.schedule_versions WHERE id=p_version;
  -- ------------------------------------------------------------ apply
 IF current_setting('test.fail_moves',true)='true' THEN RAISE EXCEPTION 'MOVE_SIMULATION_FAILURE'; END IF;
 RETURN '{}'; END $$;
SELECT set_config('test.uid','${id(1)}',false);
INSERT INTO public.schedule_versions VALUES('${id(10)}','${id(2)}','${id(3)}','draft'),('${id(11)}','${id(2)}','${id(3)}','published');
INSERT INTO assignment_version_private.enabled_versions VALUES('${id(10)}');
INSERT INTO public.instructors VALUES('${id(20)}','old'),('${id(21)}','new');
INSERT INTO public.faculty_identity_links VALUES('${id(20)}','${id(30)}'),('${id(21)}','${id(31)}');
INSERT INTO public.plan_course_components VALUES('${id(40)}','theory',3);
INSERT INTO public.academic_cohorts VALUES('${id(50)}','CYB','${id(3)}');
INSERT INTO public.plan_courses VALUES('${id(60)}','${id(61)}');
INSERT INTO public.courses VALUES('${id(61)}','MATH','Calculus');
INSERT INTO public.delivery_groups VALUES('${id(70)}','${id(50)}','${id(60)}','${id(40)}','${id(2)}',true,false),('${id(71)}','${id(50)}','${id(60)}','${id(40)}','${id(2)}',true,false);
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,session_type,weekly_hours,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours)
 VALUES('${id(80)}','${id(2)}','${id(4)}','${id(20)}','lecture',3,'${id(50)}','${id(40)}','${id(70)}',3),('${id(81)}','${id(2)}','${id(4)}','${id(20)}','lecture',3,'${id(50)}','${id(40)}','${id(71)}',3);
INSERT INTO public.schedule_sessions(schedule_version_id,teaching_assignment_id,instructor_id,day_of_week,start_time,end_time,room_id,delivery_group_id,cohort_id)
 SELECT v.id,a.id,a.instructor_id,1,CASE WHEN a.id='${id(80)}' THEN time '08:00' ELSE time '11:00' END,
 CASE WHEN a.id='${id(80)}' THEN time '11:00' ELSE time '14:00' END,'${id(5)}',a.delivery_group_id,a.cohort_id
 FROM public.schedule_versions v CROSS JOIN public.teaching_assignments a;
INSERT INTO public.faculty_teaching_requests(id,delivery_group_id,instructor_id,college_id,assigned_hours)
 VALUES('${id(90)}','${id(70)}','${id(21)}','${id(2)}',3),('${id(91)}','${id(71)}','${id(21)}','${id(2)}',3);
INSERT INTO assignment_version_private.request_scope VALUES('${id(90)}','${id(10)}','${id(80)}'),('${id(91)}','${id(10)}','${id(81)}');
`;
async function fixture() {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(
    fn("public.version_effective_assignments") +
      fn("public.validate_version_assignment_allocation") +
      fn("assignment_version_private.apply_replacement"),
  );
  await db.exec(fs.readFileSync("tests/fixtures/itcs-cohort-live-functions.sql", "utf8"));
  await db.exec(`
 CREATE FUNCTION public.test_cohort_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM faculty_private.assert_cohort_component_single_instructor(NEW.delivery_group_id,NEW.instructor_id,NEW.id);RETURN NEW; END $$;
 CREATE TRIGGER cohort_guard BEFORE INSERT ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.test_cohort_guard();
 CREATE FUNCTION public.test_session_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.teaching_assignment_id IS DISTINCT FROM OLD.teaching_assignment_id AND NOT EXISTS(
   SELECT 1 FROM public.faculty_teaching_requests WHERE assignment_id=NEW.teaching_assignment_id AND status='approved'
   AND decided_by=auth.uid() AND decided_at=now()) THEN RAISE EXCEPTION 'SESSION_APPROVAL_LINK_REQUIRED';END IF;RETURN NEW; END $$;
 CREATE TRIGGER session_guard BEFORE UPDATE ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.test_session_approval_guard();
 CREATE FUNCTION public.decide_faculty_teaching_request(rid uuid,decision text,note text) RETURNS jsonb LANGUAGE plpgsql AS $$
 DECLARE r public.faculty_teaching_requests%ROWTYPE;rs assignment_version_private.request_scope%ROWTYPE;out jsonb;
 BEGIN
  IF NOT coalesce(public.is_super_admin(auth.uid()),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.faculty_teaching_requests WHERE id=rid FOR UPDATE;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'NOT_PENDING'; END IF;
  SELECT * INTO rs FROM assignment_version_private.request_scope WHERE request_id=rid;
  UPDATE public.faculty_teaching_requests SET status=decision,decided_by=auth.uid(),decided_at=now() WHERE id=rid;
  out:=assignment_version_private.apply_replacement(rs.version_id,rs.replaces_assignment_id,r.instructor_id,r.assigned_hours,r.id);
  UPDATE public.faculty_teaching_requests SET assignment_id=(out->>'assignment_id')::uuid WHERE id=rid;
  RETURN out; END $$;
 `);
  await db.exec(
    fs.readFileSync("supabase/migrations/20260928083500_scoped_cohort_batch_decisions.sql", "utf8"),
  );
  return db;
}
test("one group alone fails atomically; both official decisions preserve cohort unity and history", async () => {
  const db = await fixture();
  try {
    const history = (
      await db.query(
        `SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
      )
    ).rows[0].h;
    await assert.rejects(
      () =>
        db.exec(
          `SELECT public.decide_faculty_teaching_request('${id(90)}','approved','test approval');`,
        ),
      /VERSION_COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.scope")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query(`SELECT status FROM public.faculty_teaching_requests WHERE id='${id(90)}'`))
        .rows[0].status,
      "pending",
    );
    const m = { history_hash: history };
    await db.exec("SELECT set_config('test.fail_moves','true',false);");
    await assert.rejects(
      () =>
        db.query(`SELECT public.itcs_cutover_execute('approve',$1,$2,$3,'manifest','baseline')`, [
          id(10),
          id(11),
          m,
        ]),
      /MOVE_SIMULATION_FAILURE/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.scope")).rows[0].n,
      0,
    );
    await db.exec("SELECT set_config('test.fail_moves','false',false);");
    await db.query(`SELECT public.itcs_cutover_execute('approve',$1,$2,$3,'manifest','baseline')`, [
      id(10),
      id(11),
      m,
    ]);
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM public.faculty_teaching_requests WHERE status='approved' AND assignment_id IS NOT NULL`,
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(DISTINCT instructor_id)::int n FROM public.schedule_sessions WHERE schedule_version_id='${id(10)}'`,
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM public.teaching_assignments WHERE id IN ('${id(80)}','${id(81)}') AND is_active`,
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query(
          `SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
        )
      ).rows[0].h,
      history,
    );
    assert.equal(
      (
        await db.query(
          `SELECT public.get_cohort_component_instructor_readiness('${id(2)}','${id(10)}')->>'ok' ok`,
        )
      ).rows[0].ok,
      "true",
    );
    await db.query(`SELECT public.itcs_cutover_execute('approve',$1,$2,$3,'manifest','baseline')`, [
      id(10),
      id(11),
      m,
    ]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.scope")).rows[0].n,
      2,
    );
    await db.exec(`SELECT set_config('test.uid','${id(99)}',false);`);
    await assert.rejects(
      () =>
        db.query(`SELECT public.itcs_cutover_execute('approve',$1,$2,$3,'manifest','baseline')`, [
          id(10),
          id(11),
          m,
        ]),
      /SUPER_ADMIN_REQUIRED/,
    );
  } finally {
    await db.close();
  }
});
