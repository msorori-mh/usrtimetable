/**
 * USR-TIMETABLE-SIMPLIFIED-TEST-ONLY-ACCEPTANCE-PACK-03
 * Pure source checks. No network, Auth, database, migration, or production write.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exactCleanupTargets,
  simplifiedAcceptanceFlow,
  TEST_ONLY_MARKER,
  testOnlyAccounts,
  testOnlyCollege,
  testOnlySchedule,
} from "../fixtures/simplified-builder-test-only/acceptance-pack.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const ids = [
  testOnlyCollege.id,
  ...testOnlyAccounts.map((account) => account.id),
  testOnlySchedule.version.id,
  ...testOnlySchedule.sessions.map((session) => session.id),
  ...testOnlySchedule.unscheduledItems.map((item) => item.id),
];

assert(new Set(ids).size === ids.length, "all TEST_ONLY IDs are unique");
assert(testOnlyAccounts.length === 3, "exactly three acceptance roles");
assert(
  testOnlyAccounts.every(
    (account) => account.marker === TEST_ONLY_MARKER && account.email.endsWith(".invalid"),
  ),
  "accounts are synthetic and non-deliverable",
);

const superAdmin = testOnlyAccounts.find((account) => account.role === "super_admin");
const collegeAdmin = testOnlyAccounts.find((account) => account.role === "college_admin");
const readOnly = testOnlyAccounts.find((account) => account.role === "read_only");

assert(superAdmin?.capabilities.manage_users, "super_admin manages users");
assert(superAdmin?.capabilities.manage_all_colleges, "super_admin manages all colleges");
assert(superAdmin?.collegeIds.length === 0, "super_admin is not narrowed to a fixture college");
assert(collegeAdmin?.collegeIds[0] === testOnlyCollege.id, "college_admin has one exact college");
assert(collegeAdmin?.capabilities.save_change, "college_admin can save a validated draft");
assert(!collegeAdmin?.capabilities.manage_users, "college_admin cannot manage users");
assert(readOnly?.collegeIds[0] === testOnlyCollege.id, "read_only has one exact college");
assert(
  readOnly && Object.values(readOnly.capabilities).every((allowed) => !allowed),
  "read_only has no mutation capability",
);

assert(testOnlySchedule.version.status === "draft", "acceptance version is draft only");
assert(testOnlySchedule.version.disposableTest, "acceptance version is disposable_test");
assert(testOnlySchedule.sessions.length === 1, "one deterministic scheduled item");
assert(testOnlySchedule.unscheduledItems.length === 1, "one deterministic work item");
assert(
  testOnlySchedule.sessions[0].expectedStudents <= testOnlySchedule.sessions[0].roomCapacity,
  "happy-path room capacity is valid",
);

assert(
  simplifiedAcceptanceFlow.join(" > ") ===
    "select_context > review_week_grid > open_unscheduled_work > apply_local_change > validate_conflicts > save_safe_change",
  "simplified acceptance flow is fixed and validation precedes save",
);

assert(exactCleanupTargets.authUserIds.length === 3, "cleanup names all three auth IDs");
assert(exactCleanupTargets.collegeIds[0] === testOnlyCollege.id, "cleanup names exact college");
assert(
  exactCleanupTargets.scheduleVersionIds[0] === testOnlySchedule.version.id,
  "cleanup names exact disposable version",
);

const fixtureSource = readFileSync(
  join(root, "tests/fixtures/simplified-builder-test-only/acceptance-pack.ts"),
  "utf8",
);
assert(!fixtureSource.includes("createClient("), "fixture cannot initialize a database client");
assert(!fixtureSource.includes("service_role"), "fixture contains no service-role secret");
assert(!fixtureSource.includes("fetch("), "fixture performs no network request");
assert(!/delete\s+from/i.test(fixtureSource), "fixture contains no SQL delete");
assert(!/insert\s+into/i.test(fixtureSource), "fixture contains no SQL insert");

console.log("simplified-builder-test-only-fixtures.harness.ts: PASS");
