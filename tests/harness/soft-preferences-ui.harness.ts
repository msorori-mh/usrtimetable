/**
 * A3.3 — Soft Preferences UI static harness (WAVE-05).
 *
 * Pure-static (no src imports): verifies the «تفضيلات المحاضرين» screen contract:
 * - schema support actually present on main (instructor_availability + is_preference + RLS manage gate)
 * - UI writes is_preference=true rows ONLY (Soft), matching greedy.ts scoring semantics
 * - independence from unavailability (Hard) screen and from structural constraints
 * - no source-only (unapplied) RPC dependencies
 * - terminology «أيام وفترات الدوام», auth/readonly gating, nav + route registration
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const PAGE = "src/routes/_authenticated/instructor-preferences.tsx";
const LAYOUT = "src/components/app-layout.tsx";
const GREEDY = "src/lib/auto-scheduler/greedy.ts";
const AVAIL = "src/routes/_authenticated/availability.tsx";
const ROUTE_TREE = "src/routeTree.gen.ts";
// Baseline (non source-only) migrations: table + RLS, then is_preference column.
const MIG_TABLE = "supabase/migrations/20260604230713_94c6fd6a-b5aa-490d-8d86-9a8f7b199e4f.sql";
const MIG_PREF = "supabase/migrations/20260605011516_481f5339-b6b0-4d53-9b71-06a1e8adbba8.sql";

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  // ---------- Files present ----------
  assert(existsSync(join(root, PAGE)), "soft preferences route file present");
  assert(existsSync(join(root, MIG_TABLE)), "instructor_availability table migration present");
  assert(existsSync(join(root, MIG_PREF)), "is_preference column migration present");

  const page = read(PAGE);
  const layout = read(LAYOUT);
  const greedy = read(GREEDY);
  const avail = read(AVAIL);
  const routeTree = read(ROUTE_TREE);
  const migTable = read(MIG_TABLE);
  const migPref = read(MIG_PREF);

  // ---------- Schema support actually on main (not source-only) ----------
  assert(migTable.includes("instructor_availability"), "schema: instructor_availability table");
  assert(
    migTable.includes("can_manage_college"),
    "schema: RLS manage gate (college_admin own college writes)",
  );
  assert(migPref.includes("is_preference"), "schema: is_preference column");
  assert(
    !MIG_TABLE.includes("source_only") && !MIG_PREF.includes("source_only"),
    "schema: UI built on baseline migrations, not source-only",
  );

  // ---------- Route registration ----------
  assert(
    page.includes('createFileRoute("/_authenticated/instructor-preferences")'),
    "route path registered in page",
  );
  assert(routeTree.includes("instructor-preferences"), "route registered in routeTree.gen.ts");
  assert(
    layout.includes('to: "/instructor-preferences"'),
    "nav entry path in app-layout",
  );
  assert(layout.includes("تفضيلات المحاضرين"), "nav label in app-layout");

  // ---------- Soft-only data contract ----------
  assert(page.includes('.eq("is_preference", true)'), "reads filtered is_preference=true only");
  assert(page.includes("is_preference: true"), "writes set is_preference=true");
  assert(!page.includes("is_preference: false"), "never writes hard (is_preference=false) rows");
  assert(
    !page.includes('.eq("is_preference", false)'),
    "never queries hard unavailability rows",
  );

  // ---------- Solver contract (UI ↔ greedy.ts semantics) ----------
  assert(
    greedy.includes('.from("instructor_availability")') && greedy.includes('.eq("is_preference", true)'),
    "solver consumes is_preference=true rows",
  );
  assert(
    greedy.includes('availability_type !== "unavailable"'),
    "solver: preferred = availability_type != unavailable",
  );
  assert(
    greedy.includes('availability_type === "unavailable"'),
    "solver: not-preferred = availability_type == unavailable",
  );
  assert(greedy.includes("score += 5"), "solver +5 preferred fit");
  assert(greedy.includes("score -= 10"), "solver -10 not-preferred overlap");
  assert(greedy.includes("score -= 3"), "solver -3 outside preferred");
  assert(
    page.includes('"available"') && page.includes('"unavailable"'),
    "UI writes both preference kinds with solver-matching availability_type",
  );

  // ---------- Independence: no source-only RPCs / no hard-screen coupling / no rooms ----------
  assert(
    !page.includes("upsertInstructorUnavailabilityBulk") &&
      !page.includes("upsertRoomUnavailabilityBulk") &&
      !page.includes("upsert_instructor_unavailability_for_active_days") &&
      !page.includes("upsert_room_unavailability_bulk"),
    "no source-only bulk unavailability RPCs (G7) — direct table writes under RLS",
  );
  assert(!page.includes("room_unavailability"), "no room preferences (schema has none)");
  assert(
    avail.includes('.eq("is_preference", false)'),
    "hard screen unchanged: still filters is_preference=false",
  );
  assert(
    !avail.includes("is_preference: true"),
    "hard screen does not write soft preferences (separation)",
  );
  assert(
    !page.includes("section_id") && !page.includes("sections"),
    "no Sections/section_id in New Flow",
  );

  // ---------- Terminology / UX markers ----------
  assert(page.includes("أيام وفترات الدوام"), "official terminology أيام وفترات الدوام");
  assert(page.includes("ناعم") || page.includes("Soft"), "soft marker in UI copy");
  assert(page.includes("soft-prefs-semantics-note"), "soft-vs-hard semantics note present");
  assert(page.includes("instructor-preferences-page"), "page marker");
  assert(page.includes("soft-pref-form"), "entry form marker");
  assert(page.includes("soft-prefs-list"), "list marker");

  // ---------- Auth / tenancy ----------
  assert(page.includes("useCanManageActiveCollege"), "manage gate hook (write actions hidden for read_only)");
  assert(page.includes("soft-prefs-readonly-note"), "read_only view-only note");
  assert(page.includes('.eq("college_id", active!.id)'), "college-scoped queries/writes");
  assert(page.includes("logAudit"), "audit logging on create/delete");

  // ---------- Reused operational-calendar helpers (no hardcoded week) ----------
  assert(page.includes("ALL_ACTIVE_DAYS_SENTINEL"), "all-active-days option");
  assert(page.includes("resolveWorkingDays"), "working days from scheduling_settings");
  assert(page.includes("groupIdenticalWindows"), "grouped display helper");

  console.log("PASS — A3.3 soft-preferences-ui harness (static)");
}

run();
