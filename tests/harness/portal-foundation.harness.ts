/**
 * portal-foundation.harness.ts — STUDENT-INSTRUCTOR-PORTAL-SOURCE-FOUNDATION-01
 * Static contract: stubs only, no role migration, no DML, no secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertNoPortalRoleMigrationInSource,
  PORTAL_FUTURE_ROLES_NOT_IN_ENUM,
  PORTAL_FOUNDATION_ROLES_TODAY,
} from "../../src/lib/portal/foundation.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const student = read("src/routes/_authenticated/portal.student.tsx");
const instructor = read("src/routes/_authenticated/portal.instructor.tsx");
const lib = read("src/lib/portal/foundation.ts");
const rbac = read("docs/PLATFORM-LAUNCH/STUDENT-INSTRUCTOR-PORTAL-FOUNDATION-RBAC.md");

assert(student.includes('createFileRoute("/_authenticated/portal/student")'), "student route");
assert(
  instructor.includes('createFileRoute("/_authenticated/portal/instructor")'),
  "instructor route",
);
assert(student.includes('dir="rtl"') || student.includes("dir='rtl'"), "student RTL");
assert(instructor.includes('dir="rtl"') || instructor.includes("dir='rtl'"), "instructor RTL");
assert(student.includes("SOURCE FOUNDATION"), "student foundation badge");
assert(instructor.includes("SOURCE FOUNDATION"), "instructor foundation badge");
assert(rbac.includes("No production accounts"), "rbac notes");
assert(rbac.includes("Not required"), "no migration required");
assert(assertNoPortalRoleMigrationInSource(""), "empty sql ok");
assert(
  !assertNoPortalRoleMigrationInSource("ALTER TYPE app_role ADD VALUE 'student';"),
  "detect student role migration",
);
assert(PORTAL_FOUNDATION_ROLES_TODAY.includes("read_only"), "today roles");
assert(PORTAL_FUTURE_ROLES_NOT_IN_ENUM.includes("student"), "future roles noted");
assert(
  read("src/components/app-layout.tsx").includes("/portal/student"),
  "nav links student portal",
);
assert(
  read("src/components/app-layout.tsx").includes("/portal/instructor"),
  "nav links instructor portal",
);

for (const src of [student, instructor, lib]) {
  assert(
    !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
      src.replace(/\s+/g, " "),
    ),
    "no schedule_sessions DML",
  );
  assert(!/service_role|DATABASE_URL/i.test(src), "no secrets");
}

assert(
  !existsSync(resolve(root, "supabase/migrations/20260731200000_portal_roles.sql")),
  "no portal roles migration file",
);

console.log("portal-foundation.harness.ts: PASS");
