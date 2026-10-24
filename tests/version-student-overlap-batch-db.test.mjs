import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.OVERLAP_DB_MODULE ?? "@electric-sql/pglite");

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = "20261024215955_batch_version_student_overlap";

test("batch overlap preserves conservative pairwise verdicts and rollback", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE schedule_sessions(id uuid, schedule_version_id uuid,
        delivery_group_id uuid, cohort_id uuid, day_of_week int,
        start_time time, end_time time, replaced_by_split boolean);
      CREATE TABLE memberships(delivery_group_id uuid, cohort_id uuid,
        partition_id uuid, partition_headcount int, expected_students int);
      CREATE FUNCTION public._sv_group_memberships(uuid,uuid[])
      RETURNS SETOF memberships LANGUAGE sql AS $$
        SELECT * FROM memberships WHERE delivery_group_id=ANY($2)
      $$;
      CREATE FUNCTION public._ss_ci(text,text,uuid,uuid,jsonb) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('code',$1,'severity',$2,
        'schedule_session_id',$3,'related_session_id',$4,'metadata',$5) $$;
    `);
    const original = read(
      "supabase/migrations/20261021020000_membership_aware_student_overlap.sql",
    );
    const start = original.indexOf("CREATE OR REPLACE FUNCTION public._sv_groups_share_students");
    const end = original.indexOf(
      "CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap",
      start,
    );
    await db.exec(original.slice(start, end));
    await db.exec(read(`supabase/rollbacks/${migration}.down.sql`));
    await db.exec(
      `ALTER FUNCTION public._sv_version_student_overlaps(uuid) RENAME TO reference_overlaps`,
    );
    await db.exec(read(`supabase/migrations/${migration}.sql`));

    // Every pair of these groups overlaps. Include missing/empty mappings,
    // full/disjoint partitions, partial coverage, merged cohorts, duplicated
    // partition rows and unknown or zero expected counts.
    const groups = [
      [],
      [[101, null, null, 30]],
      [[101, 201, 20, 20]],
      [[101, 202, 20, 20]],
      [[101, 202, 10, 30]],
      [[102, 203, 30, 30]],
      [
        [101, 201, 20, 50],
        [102, 203, 30, 50],
      ],
      [[null, 204, 10, 10]],
      [
        [101, 201, 20, 20],
        [101, 201, 20, 20],
      ],
      [[101, 201, null, 20]],
      [[101, 201, 20, 0]],
      [[101, 201, 20, null]],
      [
        [101, 201, 20, 35],
        [101, 201, 15, 35],
      ],
    ];
    for (const [i, rows] of groups.entries()) {
      for (const [cohort, partition, headcount, expected] of rows) {
        await db.query("INSERT INTO memberships VALUES($1,$2,$3,$4,$5)", [
          uuid(i + 1),
          cohort && uuid(cohort),
          partition && uuid(partition),
          headcount,
          expected,
        ]);
      }
      await db.query("INSERT INTO schedule_sessions VALUES($1,$2,$3,$4,1,'08:00','10:00',false)", [
        uuid(1000 + i),
        uuid(9000),
        uuid(i + 1),
        uuid(101),
      ]);
    }
    await db.exec(`
      INSERT INTO schedule_sessions VALUES
        ('${uuid(2000)}','${uuid(9000)}',NULL,'${uuid(101)}',1,'08:00','10:00',false),
        ('${uuid(2001)}','${uuid(9000)}','${uuid(2)}','${uuid(101)}',1,'10:00','12:00',false),
        ('${uuid(2002)}','${uuid(9000)}','${uuid(2)}','${uuid(101)}',2,'08:00','10:00',false),
        ('${uuid(2003)}','${uuid(9000)}','${uuid(2)}','${uuid(101)}',1,'08:00','10:00',true),
        ('${uuid(2004)}','${uuid(9001)}','${uuid(2)}','${uuid(101)}',1,'08:00','10:00',false),
        ('${uuid(2005)}','${uuid(9000)}','${uuid(3)}','${uuid(101)}',1,'08:00','10:00',false);
    `);
    const normalize = (items) => items.map((item) => JSON.stringify(item)).sort();
    const compare = async (version) => {
      const {
        rows: [row],
      } = await db.query(
        `SELECT
        reference_overlaps($1) AS old, _sv_version_student_overlaps($1) AS new`,
        [version],
      );
      assert.deepEqual(normalize(row.new), normalize(row.old));
      return row.new;
    };
    assert.ok((await compare(uuid(9000))).length > 0);
    assert.deepEqual(await compare(uuid(9999)), []);
    const {
      rows: [acl],
    } = await db.query(`SELECT
      has_function_privilege('authenticated','_sv_version_student_overlaps(uuid)','execute') allowed`);
    assert.equal(acl.allowed, false);
    await db.exec(read(`supabase/rollbacks/${migration}.down.sql`));
    await compare(uuid(9000));
  } finally {
    await db.close();
  }
});
