import { readPrimaryNavigationSource } from "./nav-source";
/**
 * INSTITUTIONAL_VIEWER_RBAC — source-only static contract harness.
 *
 * Proves BY SOURCE INSPECTION (no live database is contacted):
 *  1. the role exists in the app role union and in the generated DB enum type;
 *  2. every navigation entry is visible to institutional_viewer;
 *  3. can_manage_college / useCanManageActiveCollege were NOT widened;
 *  4. the two migrations are split (enum add, then usage) and touch SELECT only;
 *  5. admin pages render a read-only variant with no write controls for the role;
 *  6. user creation accepts the role without requiring a college.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

// ---------- 1) types ----------
const cu = read("src/hooks/use-current-user.ts");
assert(
  /export type AppRole =[^;]*"institutional_viewer"/.test(cu),
  "AppRole union includes institutional_viewer",
);
assert(
  cu.includes('isInstitutionalViewer: roles.includes("institutional_viewer")'),
  "isInstitutionalViewer derives from user_roles (never user_metadata)",
);
assert(!cu.includes("user_metadata"), "no user_metadata used for authorization");

const dbTypes = read("src/integrations/supabase/types.ts");
assert(
  dbTypes.includes("institutional_viewer"),
  "generated Supabase types carry the new app_role value",
);

// ---------- 2) navigation: every entry visible to the role ----------
const layout = readPrimaryNavigationSource(root);
assert(
  /const ALL: Role\[\] = \["super_admin", "college_admin", "read_only", "institutional_viewer"\]/.test(
    layout,
  ),
  "ALL roles constant includes institutional_viewer",
);
const roleLists = [...layout.matchAll(/roles:\s*(ALL|\[[^\]]*\])/g)].map((m) => m[1]);
assert(roleLists.length > 20, "navigation role lists were found for inspection");
const navMissingViewer = roleLists.filter(
  (r) => r !== "ALL" && !r.includes("institutional_viewer"),
);
assert(
  navMissingViewer.length === 0,
  `every nav entry visible to institutional_viewer (missing in: ${navMissingViewer.join(" | ")})`,
);
assert(layout.includes("مشاهد مؤسسي"), "sidebar shows the Arabic role label «مشاهد مؤسسي»");

// ---------- 3) no manage-privilege expansion ----------
const canManageHook = read("src/hooks/use-can-manage.ts");
assert(
  !canManageHook.includes("institutional_viewer") &&
    !canManageHook.includes("isInstitutionalViewer"),
  "useCanManageActiveCollege NOT widened (can_manage stays false for the viewer)",
);

// ---------- 4) migrations: split + SELECT-only ----------
const enumMigration = read(
  "supabase/migrations/20260907011528_5aff0fb9-b1ca-461d-9396-b3a52b763f2d.sql",
);
assert(
  /ALTER TYPE public\.app_role ADD VALUE IF NOT EXISTS 'institutional_viewer'/.test(enumMigration),
  "migration 1 only adds the enum value",
);
assert(
  !/CREATE POLICY|CREATE OR REPLACE FUNCTION/i.test(enumMigration),
  "migration 1 does not use the new enum value in the same transaction",
);

const rlsMigration = read(
  "supabase/migrations/20260907011642_82a09c5b-0bb2-4101-8ed8-1e27db772d16.sql",
);
assert(
  /CREATE OR REPLACE FUNCTION public\.can_view_college[\s\S]*is_institutional_viewer/.test(
    rlsMigration,
  ),
  "migration 2 widens can_view_college only",
);
assert(
  !/FUNCTION public\.can_manage_college/.test(rlsMigration),
  "migration 2 never touches can_manage_college",
);
const newPolicies = [...rlsMigration.matchAll(/CREATE POLICY\s+(\w+)[\s\S]*?FOR\s+(\w+)/g)].map(
  (m) => ({ name: m[1], cmd: m[2].toUpperCase() }),
);
assert(newPolicies.length >= 6, "migration 2 policies were found for inspection");
const widenedWrite = newPolicies.filter(
  (p) =>
    p.cmd !== "SELECT" &&
    !(p.name === "al_insert" && /NOT is_institutional_viewer/.test(rlsMigration)),
);
assert(
  widenedWrite.length === 0,
  `no INSERT/UPDATE/DELETE policy grants the viewer anything (offenders: ${widenedWrite
    .map((p) => `${p.name}:${p.cmd}`)
    .join(", ")})`,
);
assert(
  /al_insert[\s\S]*NOT is_institutional_viewer\(auth\.uid\(\)\)/.test(rlsMigration),
  "the only authenticated write policy (audit_logs insert) excludes the viewer",
);

// ---------- 5) admin pages: read-only variant, zero write controls ----------
const helpers = read("src/lib/unauthorized-access.ts");
assert(
  helpers.includes("isInstitutionalReadOnlyViewer") &&
    helpers.includes("resolveAdminReadablePageAccess") &&
    helpers.includes("READ_ONLY_VIEW_BADGE_AR"),
  "central access helpers exist (single guard reused by pages)",
);

for (const page of [
  "src/routes/_authenticated/universities.tsx",
  "src/routes/_authenticated/colleges.tsx",
  "src/routes/_authenticated/users.tsx",
  "src/routes/_authenticated/import.tsx",
]) {
  const src = read(page);
  assert(
    src.includes("isInstitutionalReadOnlyViewer") && src.includes("READ_ONLY_VIEW_BADGE_AR"),
    `${page} uses the central viewer guard and shows the read-only badge`,
  );
  assert(/viewOnly/.test(src), `${page} branches on viewOnly to hide write controls`);
}

const users = read("src/routes/_authenticated/users.tsx");
assert(
  /viewOnly\s*\n?\s*\?\s*Promise\.resolve/.test(users) ||
    /viewOnly[\s\S]{0,200}Promise\.resolve\(\[\] as Awaited<ReturnType<typeof listMeta>>\)/.test(
      users,
    ),
  "users page never calls adminListUserMeta for the viewer",
);
assert(/\{!viewOnly && \(/.test(users), "users page hides create/manage controls for the viewer");

const usersFn = read("src/lib/users.functions.ts");
assert(
  usersFn.includes('eq("role", "super_admin")') &&
    usersFn.includes("Forbidden: institution admin only"),
  "server user-admin endpoints remain super_admin-only",
);
assert(
  /const ROLE = z\.enum\(\["super_admin", "college_admin", "read_only", "institutional_viewer"\]\)/.test(
    usersFn,
  ),
  "user creation accepts the new role",
);
assert(
  /data\.role === "college_admin" \|\| data\.role === "read_only"/.test(usersFn),
  "college assignment is NOT required for the institutional viewer",
);

// ---------- 6) operational pages: browse-safe, execution disabled ----------
const autoSchedule = read("src/routes/_authenticated/auto-schedule.tsx");
assert(
  /disabled=\{!canManage/.test(autoSchedule) && autoSchedule.includes("أنت بوضع المشاهدة"),
  "auto-schedule run control is disabled and a viewing notice is shown",
);
const cleanup = read("src/routes/_authenticated/data-cleanup.tsx");
assert(
  cleanup.includes("{!canManage && (") && /canManage \?/.test(cleanup),
  "data-cleanup fix actions render only when canManage",
);
const importPage = read("src/routes/_authenticated/import.tsx");
const viewerBlock = importPage.slice(
  importPage.indexOf("if (viewOnly)"),
  importPage.indexOf("if (!canManage)"),
);
assert(viewerBlock.length > 100, "import page has a dedicated viewer branch");
assert(
  !/type="file"|commitImport|onConfirm|Upload\s*\/>/.test(viewerBlock),
  "import viewer branch contains no upload/commit controls",
);

// ---------- 7) proposed migration 3: minimal, targeted, zero-write ----------
const zeroWrite = read(
  "docs/migrations-proposed/20260907013500_institutional_viewer_zero_write_enforcement.sql",
);
const zwExec = zeroWrite.replace(/^\s*--.*$/gm, "");
assert(zeroWrite.includes("STATUS: NOT APPLIED"), "migration 3 is documented as not applied");

// no enforcement layer, no RPC surgery
assert(
  !/CREATE TRIGGER/i.test(zwExec) && !/DROP TRIGGER/i.test(zwExec),
  "migration 3 creates no trigger at all",
);
assert(!/DO \$do\$|DO \$\$/i.test(zwExec), "migration 3 contains no DO loop over tables");
{
  const fns = [...zwExec.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
  assert(
    fns.length === 1 && fns[0] === "is_institutional_read_only_actor",
    `the helper is the only function defined (saw: ${fns.join(", ") || "none"})`,
  );
  const granted = [...zwExec.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].map((m) => m[1]);
  const revoked = [...zwExec.matchAll(/REVOKE ALL ON FUNCTION public\.(\w+)/g)].map((m) => m[1]);
  assert(
    granted.length === 1 &&
      granted[0] === "is_institutional_read_only_actor" &&
      revoked.length === 1 &&
      revoked[0] === "is_institutional_read_only_actor",
    "no RPC is re-granted or re-revoked; only the helper",
  );
  for (const rpc of [
    "compute_instructor_standard_workload",
    "get_delivery_group_assignment_candidates",
    "list_schedule_builder_v2_work_items",
    "list_teaching_assignment_workspace",
    "resolve_scheduling_headcount",
    "list_scheduling_headcount_revisions",
    "validate_schedule_session_move",
    "begin_schedule_quality_snapshot",
    "can_manage_college",
  ]) {
    assert(!new RegExp(`\\b${rpc}\\b`).test(zwExec), `${rpc} is untouched by executable SQL`);
  }
}

// multi-role safe helper
assert(
  /CREATE OR REPLACE FUNCTION public\.is_institutional_read_only_actor\(_user_id uuid\)/.test(
    zwExec,
  ) &&
    /STABLE/.test(zwExec) &&
    /SECURITY DEFINER/.test(zwExec) &&
    /SET search_path = public, pg_temp/.test(zwExec),
  "helper is STABLE + SECURITY DEFINER with a pinned search_path",
);
assert(
  /has_role\(_user_id, 'institutional_viewer'::public\.app_role\)\s*\n\s*AND NOT public\.is_super_admin\(_user_id\)\s*\n\s*AND NOT public\.has_role\(_user_id, 'college_admin'::public\.app_role\)/.test(
    zwExec,
  ),
  "helper is TRUE only for a viewer who is neither super_admin nor college_admin",
);
assert(
  /REVOKE ALL ON FUNCTION public\.is_institutional_read_only_actor\(uuid\) FROM PUBLIC, anon/.test(
    zwExec,
  ) &&
    /GRANT EXECUTE ON FUNCTION public\.is_institutional_read_only_actor\(uuid\) TO authenticated, service_role/.test(
      zwExec,
    ),
  "helper is revoked from PUBLIC/anon and granted to authenticated + service_role",
);
{
  const helperSrc = read("src/lib/unauthorized-access.ts");
  assert(
    /!me\.isSuperAdmin && !me\.isCollegeAdmin && !!me\.isInstitutionalViewer/.test(helperSrc),
    "isInstitutionalReadOnlyViewer mirrors the SQL multi-role predicate",
  );
}

// exactly three write policies touched, conditions preserved
{
  const touched = [...zwExec.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+public\.(\w+)/g)].map(
    (m) => `${m[2]}.${m[1]}`,
  );
  assert(
    touched.length === 3 &&
      touched.includes("profiles.prof_insert") &&
      touched.includes("profiles.prof_update") &&
      touched.includes("audit_logs.al_insert"),
    `only the three self-service write policies are re-created (saw: ${touched.join(", ")})`,
  );
  const dropped = [...zwExec.matchAll(/DROP POLICY IF EXISTS\s+(\w+)/g)].map((m) => m[1]);
  assert(
    dropped.length === 3 && !dropped.includes("al_select"),
    "no SELECT policy is dropped (al_select and all reads stay as they are)",
  );
  for (const name of ["prof_insert", "prof_update", "al_insert"]) {
    const at = zwExec.indexOf(`CREATE POLICY ${name} `);
    const block = zwExec.slice(at, zwExec.indexOf(";", at));
    assert(
      /AND NOT public\.is_institutional_read_only_actor\(auth\.uid\(\)\)/.test(block),
      `${name} adds the read-only-actor exclusion`,
    );
    const preserved =
      name === "al_insert"
        ? /\(actor_id = auth\.uid\(\)\)/
        : /\(id = auth\.uid\(\)\) OR public\.is_super_admin\(auth\.uid\(\)\)/;
    assert(preserved.test(block), `${name} keeps its original condition`);
  }
  // multi-role regression: the blanket viewer ban must be gone from al_insert
  const alBlock = zwExec.slice(
    zwExec.indexOf("CREATE POLICY al_insert "),
    zwExec.indexOf(";", zwExec.indexOf("CREATE POLICY al_insert ")),
  );
  assert(
    !/NOT public\.is_institutional_viewer\(auth\.uid\(\)\)/.test(alBlock),
    "al_insert drops migration 2's blanket viewer ban so multi-role admins keep audit writes",
  );
}

// rollback restores all three and drops the helper last
{
  const rb = zeroWrite.slice(zeroWrite.indexOf("-- ROLLBACK"));
  for (const frag of [
    "CREATE POLICY prof_insert",
    "CREATE POLICY prof_update",
    "WITH CHECK (actor_id = auth.uid())",
    "DROP FUNCTION IF EXISTS public.is_institutional_read_only_actor(uuid)",
  ]) {
    assert(rb.includes(frag), `rollback covers: ${frag}`);
  }
  assert(
    rb.indexOf("DROP FUNCTION IF EXISTS public.is_institutional_read_only_actor") >
      rb.indexOf("CREATE POLICY al_insert"),
    "rollback drops the helper only after the policies stop referencing it",
  );
}

// documented invariants that justify the reduced scope
{
  const report = read("docs/INSTITUTIONAL-VIEWER-RBAC-SOURCE-ONLY-01.md");
  assert(
    /175 write polic/i.test(report) &&
      /prof_insert[\s\S]{0,400}prof_update[\s\S]{0,400}al_insert/.test(report),
    "report records the 175-policy audit and names the only three self-service exceptions",
  );
  for (const fn of [
    "compute_instructor_standard_workload",
    "get_delivery_group_assignment_candidates",
    "list_schedule_builder_v2_work_items",
    "list_teaching_assignment_workspace",
  ]) {
    assert(report.includes(fn), `report names the read RPC ${fn}`);
  }
  assert(
    /can_view_college[\s\S]{0,600}already[\s\S]{0,200}(pass|include)/i.test(report),
    "report documents that the four read gates already pass through can_view_college",
  );
  assert(
    /can_manage_college[\s\S]{0,200}('can_manage'|write-affordance)/.test(report),
    "report documents that can_manage_college survives only as a write-affordance flag",
  );
}
assert(
  /CREATE OR REPLACE FUNCTION public\.can_view_college[\s\S]*is_institutional_viewer/.test(
    rlsMigration,
  ),
  "migration 2 (applied) is what makes the viewer pass can_view_college",
);

if (failures > 0) {
  console.error(`institutional-viewer-rbac.harness.ts: FAIL (${failures})`);
  process.exit(1);
}
console.log("institutional-viewer-rbac.harness.ts: PASS");
