import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("room amendment binds the prior receipt, uses the live move writer, and preserves history atomically", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 CREATE SCHEMA auth; CREATE SCHEMA itcs_cutover_private; CREATE SCHEMA assignment_version_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE FUNCTION public.is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${id(1)}' $$;
 CREATE FUNCTION public.can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.is_super_admin(u) $$;
 CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY,college_id uuid,status text);
 CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY,schedule_version_id uuid,teaching_assignment_id uuid,instructor_id uuid,
   college_id uuid,day_of_week smallint,start_time time,end_time time,room_id uuid,delivery_group_id uuid,cohort_id uuid,is_locked boolean DEFAULT false);
 CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY,college_id uuid,required_room_type text,plan_course_component_id uuid);
 CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY,component_type text);
 CREATE TABLE public.rooms(id uuid PRIMARY KEY,college_id uuid,is_active boolean,room_type text);
 CREATE TABLE public.audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
 CREATE TABLE assignment_version_private.publish_expectation(version_id uuid PRIMARY KEY,expected_sessions integer,expected_snapshot text,set_by uuid,set_at timestamptz DEFAULT now());
 CREATE TABLE assignment_version_private.move_receipts(version_id uuid,before_snapshot text,after_snapshot text,moved integer,actor uuid,applied_at timestamptz DEFAULT now());
 CREATE TABLE itcs_cutover_private.runs(version_id uuid,manifest_sha text,stage text,result jsonb,actor uuid,PRIMARY KEY(version_id,manifest_sha,stage));
 CREATE FUNCTION itcs_cutover_private.assert_history(m jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE h text; BEGIN
  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) INTO h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}';
  IF h IS DISTINCT FROM m->>'history' THEN RAISE EXCEPTION 'HISTORY_CHANGED'; END IF; END $$;
 CREATE FUNCTION itcs_cutover_private.preflight(v uuid,p uuid,m jsonb,h text,s text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF md5(m::text)<>h OR v<>'${id(10)}' OR p<>'${id(11)}' THEN RAISE EXCEPTION 'PREFLIGHT_FAILED'; END IF;
  PERFORM itcs_cutover_private.assert_history(m); RETURN '{}'; END $$;
 CREATE FUNCTION itcs_cutover_private.replacement_status(uuid,jsonb) RETURNS TABLE(state text,relinked boolean) LANGUAGE sql AS $$ SELECT 'applied',true $$;
 CREATE FUNCTION public.itcs_cutover_path_rules(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('ok',coalesce(current_setting('test.fail_final',true),'false')<>'true') $$;
 CREATE FUNCTION public.itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
 RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF p_stage NOT IN ('approve','publish') THEN RAISE EXCEPTION 'INVALID_STAGE'; END IF;
  RETURN '{}'; END $$;
 CREATE FUNCTION public.final_room_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.schedule_sessions a JOIN public.schedule_sessions b ON a.id<b.id
    AND a.schedule_version_id=b.schedule_version_id AND a.room_id=b.room_id AND a.day_of_week=b.day_of_week
    AND a.start_time<b.end_time AND b.start_time<a.end_time WHERE a.schedule_version_id=NEW.schedule_version_id)
  THEN RAISE EXCEPTION 'ROOM_CLASH'; END IF; RETURN NULL; END $$;
 CREATE CONSTRAINT TRIGGER coordination_sessions_final AFTER UPDATE ON public.schedule_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.final_room_guard();
 CREATE CONSTRAINT TRIGGER instructor_daily_session_cap_final AFTER UPDATE ON public.schedule_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.final_room_guard();
 INSERT INTO public.schedule_versions VALUES('${id(10)}','${id(2)}','draft'),('${id(11)}','${id(2)}','published');
 INSERT INTO public.rooms VALUES('${id(40)}','${id(2)}',true,'seminar_room'),('${id(41)}','${id(2)}',true,'lecture_hall'),('${id(42)}','${id(2)}',true,'seminar_room');
 INSERT INTO public.teaching_assignments VALUES('${id(50)}','${id(2)}','lecture_hall',NULL),('${id(51)}','${id(2)}',NULL,NULL);
 INSERT INTO public.schedule_sessions(id,schedule_version_id,teaching_assignment_id,instructor_id,college_id,day_of_week,start_time,end_time,room_id)
 VALUES('${id(20)}','${id(10)}','${id(50)}','${id(60)}','${id(2)}',1,'08:00','10:00','${id(40)}'),
 ('${id(21)}','${id(10)}','${id(51)}','${id(61)}','${id(2)}',1,'08:00','10:00','${id(41)}'),
 ('${id(22)}','${id(11)}','${id(50)}','${id(60)}','${id(2)}',1,'08:00','10:00','${id(40)}');
 SELECT set_config('test.uid','${id(1)}',false);
 `);
    await db.exec(fs.readFileSync("tests/fixtures/itcs-room-moves-live.sql", "utf8"));
    await db.exec(
      fs.readFileSync(
        "supabase/migrations/20260928100000_integrated_itcs_room_amendment.sql",
        "utf8",
      ),
    );
    const history = (
      await db.query(
        `SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
      )
    ).rows[0].h;
    const before = (
      await db.query(`SELECT public.schedule_version_session_snapshot('${id(10)}') s`)
    ).rows[0].s;
    const base = {
      history,
      sessions: [
        {
          session_id: id(20),
          changed: true,
          old: { day: 2, start: "08:00", end: "10:00", room: id(40) },
          new: { day: 1, start: "08:00", end: "10:00", room: id(40) },
        },
        {
          session_id: id(21),
          changed: true,
          old: { day: 2, start: "08:00", end: "10:00", room: id(41) },
          new: { day: 1, start: "08:00", end: "10:00", room: id(41) },
        },
      ],
    };
    await db.query(
      `INSERT INTO itcs_cutover_private.runs VALUES($1,md5($2::jsonb::text),'applied',jsonb_build_object('after_snapshot',$3::text),$4)`,
      [id(10), base, before, id(1)],
    );
    await db.query(`SELECT public.seal_version_publish_expectation($1,2,$2)`, [id(10), before]);
    const corrected = structuredClone(base);
    corrected.sessions[0].new.room = id(41);
    corrected.sessions[1].new.room = id(40);
    const run = (m = corrected) =>
      db.query(
        `SELECT public.itcs_cutover_execute('rooms',$1,$2,$3,md5($3::jsonb::text),'history') r`,
        [id(10), id(11), m],
      );
    const drift = structuredClone(corrected);
    drift.sessions[0].new.start = "09:00";
    await assert.rejects(() => run(drift), /ROOM_AMENDMENT_NOT_BOUND/);
    await db.exec(`SELECT set_config('test.uid','${id(99)}',false);`);
    await assert.rejects(() => run(), /SUPER_ADMIN_REQUIRED/);
    await db.exec(`SELECT set_config('test.uid','${id(1)}',false);
      UPDATE public.schedule_sessions SET is_locked=true WHERE id='${id(20)}';`);
    await assert.rejects(() => run(), /MOVE_LOCKED_SESSION/);
    await db.exec(`UPDATE public.schedule_sessions SET is_locked=false WHERE id='${id(20)}';`);
    const bad = structuredClone(corrected);
    bad.sessions[0].new.room = id(42);
    await assert.rejects(() => run(bad), /ROOM_AMENDMENT_INCOMPATIBLE/);
    await db.exec("SELECT set_config('test.fail_final','true',false);");
    await assert.rejects(() => run(), /PATH_RULES_FAILED/);
    assert.equal(
      (await db.query(`SELECT public.schedule_version_session_snapshot('${id(10)}') s`)).rows[0].s,
      before,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.move_receipts"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM itcs_cutover_private.runs")).rows[0].n,
      1,
    );
    await db.exec("SELECT set_config('test.fail_final','false',false);");
    const applied = (await run()).rows[0].r;
    assert.equal(applied.moves.moved, 2);
    assert.equal(applied.room_only_amendment, true);
    assert.equal(
      (
        await db.query(
          `SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) h FROM public.schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
        )
      ).rows[0].h,
      history,
    );
    assert.equal((await run()).rows[0].r.replayed, true);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.move_receipts"))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
