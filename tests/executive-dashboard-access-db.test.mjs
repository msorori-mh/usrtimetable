import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.LEADERSHIP_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("actual executive RPC guards: academic assignments, dean isolation, mixed roles and anonymous denial", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("./leadership-fixture.sql", import.meta.url), "utf8"));
    await db.exec(
      "ALTER TYPE app_role ADD VALUE 'college_dean'; ALTER TYPE app_role ADD VALUE 'university_leadership'; ALTER TABLE colleges ADD COLUMN code text;",
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260922230000_academic_affairs_executive_dashboard.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`INSERT INTO colleges VALUES ('${id(1)}','كلية أ','A'),('${id(2)}','كلية ب','B');
      INSERT INTO user_roles VALUES ('${id(11)}','institutional_viewer'),('${id(12)}','college_dean'),('${id(13)}','read_only'),('${id(14)}','super_admin'),('${id(15)}','university_leadership');
      INSERT INTO user_colleges VALUES ('${id(11)}','${id(1)}'),('${id(11)}','${id(2)}'),('${id(12)}','${id(1)}');`);
    const actor = async (n) => {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : ""]);
      await db.exec("SET ROLE authenticated");
    };
    // Deliberately invalid inputs stop after the real auth/scope guards, before data aggregation.
    const detail = (college = null) =>
      db.query("SELECT leadership_metric_details('invalid','2026','first',$1)", [college]);
    const overview = () => db.query("SELECT leadership_overview('invalid','first')");
    for (const n of [11, 14, 15]) {
      await actor(n);
      await assert.rejects(detail(), /UNKNOWN_METRIC/);
      await assert.rejects(overview(), /ACADEMIC_PERIOD_NOT_FOUND/);
    }
    await actor(12);
    await assert.rejects(detail(id(1)), /UNKNOWN_METRIC/);
    await assert.rejects(detail(id(2)), /COLLEGE_SCOPE_VIOLATION/);
    await db.exec("RESET ROLE");
    await db.exec(`DELETE FROM user_colleges WHERE user_id='${id(11)}' AND college_id='${id(2)}';`);
    await actor(11);
    await assert.rejects(detail(), /insufficient_privilege/);
    await assert.rejects(overview(), /insufficient_privilege/);
    assert.equal(
      (await db.query("SELECT can_manage_college(auth.uid(),$1) AS allowed", [id(1)])).rows[0]
        .allowed,
      false,
    );
    await db.exec("RESET ROLE");
    await db.exec(
      `INSERT INTO user_roles VALUES ('${id(12)}','institutional_viewer'); INSERT INTO user_colleges VALUES ('${id(12)}','${id(2)}');`,
    );
    await actor(12);
    await assert.rejects(detail(), /COLLEGE_DEAN_REQUIRES_EXACTLY_ONE_COLLEGE/);
    for (const n of [13, null]) {
      await actor(n);
      await assert.rejects(detail(), /insufficient_privilege/);
      await assert.rejects(overview(), /insufficient_privilege/);
    }
    await db.exec("RESET ROLE; SET ROLE anon;");
    await assert.rejects(detail(), /permission denied/);
    await assert.rejects(overview(), /permission denied/);
  } finally {
    await db.close();
  }
});
