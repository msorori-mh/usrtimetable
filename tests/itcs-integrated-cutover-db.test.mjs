import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const root = process.cwd();
const draft = "258f6f60-539e-43e1-a4bb-f0b07c20c9ab";
const migrationFiles = {
  "20260927_itcs_version_scoped_assignments.sql": "20260928082000_version_scoped_assignments.sql",
  "20260927b_itcs_version_scoped_workload_guards.sql": "20260928082500_version_scoped_workload.sql",
  "20260927c_itcs_cutover_orchestrator.sql": "20260928083000_integrated_itcs_cutover.sql",
};
const rev2 = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations",
    migrationFiles["20260927_itcs_version_scoped_assignments.sql"],
  ),
  "utf8",
);
const names = [
  "public.version_effective_assignments",
  "public.validate_version_assignment_allocation",
  "public.schedule_version_session_snapshot",
  "assignment_version_private.apply_replacement",
  "public.preview_version_session_moves",
  "public.apply_version_session_moves",
  "public.guard_session_version_scoped_assignment",
  "public.guard_version_scoped_publish",
];
const writers = names
  .map((n) => {
    const re = new RegExp(
      "^CREATE FUNCTION " + n.replaceAll(".", "\\.") + "\\([\\s\\S]*?^(?:END )?\\$\\$;\\n",
      "m",
    );
    const m = rev2.match(re);
    assert.ok(m, `Writer ${n}`);
    return m[0];
  })
  .join("\n");
const membershipFixture = `
ALTER TABLE public.schedule_version_conflict_exceptions ADD COLUMN metadata jsonb,
 ADD COLUMN approval_type text, ADD COLUMN conflict_code text;
CREATE TABLE public.version_membership_fixture(version_id uuid,delivery_group_id uuid,cohort_id uuid,partition_id uuid);
CREATE FUNCTION public.schedule_version_student_memberships(v uuid,gs uuid[])
RETURNS TABLE(delivery_group_id uuid,cohort_id uuid,partition_id uuid)
LANGUAGE plpgsql STABLE AS $$ BEGIN
 IF cardinality(gs)>100 THEN RAISE EXCEPTION 'BATCH_TOO_LARGE'; END IF;
 RETURN QUERY
 SELECT f.delivery_group_id,f.cohort_id,f.partition_id FROM public.version_membership_fixture f
 WHERE f.version_id=v AND f.delivery_group_id=ANY(gs)
 UNION
 SELECT requested.gid,NULL::uuid,m.partition_id
 FROM unnest(gs) requested(gid)
 CROSS JOIN LATERAL public.shared_lecture_group_ids(requested.gid) linked
 JOIN public.delivery_group_partition_members m ON m.delivery_group_id=linked.group_id
 WHERE NOT EXISTS(SELECT 1 FROM public.version_membership_fixture f WHERE f.version_id=v AND f.delivery_group_id=requested.gid);
 END $$;
`;
function expand(file, fixture = false) {
  const target = migrationFiles[path.basename(file)];
  let s = file.endsWith(".rev2-writers.sql")
    ? writers
    : fs.readFileSync(target ? path.join(root, "supabase/migrations", target) : file, "utf8");
  if (fixture && file.endsWith("itcs-cutover-orchestrator-db.sql"))
    s = s.replace("-- 1) Compile", () => membershipFixture + "\n-- 1) Compile");
  s = s
    .replace(/^\\i[r]?\s+(.+)$/gm, (_, f) => expand(path.resolve(path.dirname(file), f.trim())))
    .replace(/^\\(?:set|echo).*$/gm, "")
    .replaceAll(":ITCS", "'7168345f-cf9d-4789-b2ad-547abb687dc8'");
  if (file.endsWith("-db.sql") && !file.endsWith("itcs-cutover-orchestrator-db.sql"))
    s = s.replaceAll("d68d8d22-9a6d-4f21-935f-cebf18bb969b", draft);
  return s;
}
for (const [name, description] of [
  [
    "itcs-version-scoped-assignments-db.sql",
    "scoped replacements preserve history, enforce approval and CAS, and roll back",
  ],
  [
    "itcs-version-scoped-workload-guards-db.sql",
    "projected workload and published lifecycle count exactly one assignment",
  ],
  [
    "itcs-cutover-orchestrator-db.sql",
    "selected-version student paths, conflicts, availability, and authorization",
  ],
])
  test(description, async () => {
    const db = new PGlite();
    try {
      await db.exec(expand(path.join(root, "tests", name), true));
      if (name === "itcs-cutover-orchestrator-db.sql") {
        await db.exec(`SELECT set_config('t.uid','00000000-0000-0000-0000-00000000000a',false);
    INSERT INTO public.version_membership_fixture VALUES
    ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',NULL,'20000000-0000-0000-0000-000000000003');`);
        const r = await db.query(
          `SELECT unit FROM public.itcs_cutover_session_units('10000000-0000-0000-0000-000000000001') WHERE session_id='40000000-0000-0000-0000-000000000001'`,
        );
        assert.deepEqual(
          r.rows,
          [{ unit: "p:20000000-0000-0000-0000-000000000003" }],
          "snapshot membership wins over the global membership",
        );
        await db.exec(`SELECT set_config('t.uid','00000000-0000-0000-0000-00000000000b',false);`);
        await assert.rejects(
          () =>
            db.query(
              `SELECT * FROM public.itcs_cutover_session_units('10000000-0000-0000-0000-000000000001')`,
            ),
          /SUPER_ADMIN_REQUIRED/,
        );
      }
    } finally {
      await db.close();
    }
  });
