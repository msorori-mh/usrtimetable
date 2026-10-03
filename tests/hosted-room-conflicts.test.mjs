import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.HOSTING_DB_MODULE ||
    "../.test-runtime/node_modules/@electric-sql/pglite/dist/index.js"
);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sql = await readFile(
  new URL(
    "../supabase/migrations/20260919111000_hosted_room_conflict_checks.sql",
    import.meta.url,
  ),
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA hosting_private;
 CREATE TABLE academic_terms(id uuid PRIMARY KEY,start_date date,end_date date);
 CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid,status text,is_coordination boolean DEFAULT false);
 CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,schedule_version_id uuid,room_id uuid,day_of_week integer,start_time time,end_time time,replaced_by_split boolean DEFAULT false);
 INSERT INTO academic_terms VALUES('${id(1)}','2026-09-01','2026-12-31'),('${id(2)}','2026-09-01','2026-12-31');
 INSERT INTO schedule_versions(id,college_id,academic_term_id,status) VALUES('${id(10)}','${id(20)}','${id(1)}','draft'),('${id(11)}','${id(21)}','${id(2)}','published');
 INSERT INTO schedule_sessions(id,schedule_version_id,room_id,day_of_week,start_time,end_time) VALUES('${id(30)}','${id(11)}','${id(40)}',0,'08:00','10:00');
 `);
  await db.exec(sql);
  return db;
}
const check = (start = "09:00", end = "11:00", day = 0, exclude = "NULL") =>
  `SELECT hosting_private.assert_room_slot_free('${id(10)}','${id(40)}',${day},'${start}','${end}',${exclude})`;

test("shared physical room blocks overlap but permits adjacent intervals and different days", async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.exec(check()), /HOSTING_ROOM_TIME_CONFLICT/);
    await db.exec(check("10:00", "12:00"));
    await db.exec(check("06:00", "08:00"));
    await db.exec(check("08:00", "10:00", 1));
    // An external session cannot be hidden by passing its ID as a self-exclusion.
    await assert.rejects(
      db.exec(check("09:00", "11:00", 0, `'${id(30)}'`)),
      /HOSTING_ROOM_TIME_CONFLICT/,
    );
  } finally {
    await db.close();
  }
});

test("reference selection respects archived, draft and coordination state", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `UPDATE schedule_versions SET status='archived' WHERE id='${id(11)}'`,
    );
    await db.exec(check());
    await db.exec(
      `UPDATE schedule_versions SET status='draft' WHERE id='${id(11)}'`,
    );
    await db.exec(check());
    await db.exec(
      `UPDATE schedule_versions SET is_coordination=true WHERE id='${id(11)}'`,
    );
    await assert.rejects(db.exec(check()), /HOSTING_ROOM_TIME_CONFLICT/);
    await db.exec(`UPDATE schedule_sessions SET replaced_by_split=true`);
    await db.exec(check());
  } finally {
    await db.close();
  }
});

test("calendar intersection must contain the scheduled weekday; missing dates fail closed", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `UPDATE academic_terms SET start_date='2027-01-01',end_date='2027-02-01' WHERE id='${id(2)}'`,
    );
    await db.exec(check());
    // September 7, 2026 is Monday: an intersection on Monday has no Sunday slot.
    await db.exec(
      `UPDATE academic_terms SET start_date='2026-09-07',end_date='2026-09-07' WHERE id='${id(2)}'`,
    );
    await db.exec(check());
    await db.exec(
      `UPDATE academic_terms SET start_date=NULL WHERE id='${id(2)}'`,
    );
    await assert.rejects(db.exec(check()), /HOSTING_TERM_DATES_REQUIRED/);
    await assert.rejects(
      db.exec(check("10:00", "08:00")),
      /HOSTING_SLOT_INVALID/,
    );
    await assert.rejects(
      db.exec(check("08:00", "10:00", 7)),
      /HOSTING_SLOT_INVALID/,
    );
  } finally {
    await db.close();
  }
});

test("same-version self-exclusion works and unprivileged callers cannot probe external bookings", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `UPDATE schedule_sessions SET schedule_version_id='${id(10)}'`,
    );
    await assert.rejects(db.exec(check()), /HOSTING_ROOM_TIME_CONFLICT/);
    await db.exec(check("09:00", "11:00", 0, `'${id(30)}'`));
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.exec(check()), /permission denied/);
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(db.exec(check()), /permission denied/);
  } finally {
    await db.close();
  }
});
