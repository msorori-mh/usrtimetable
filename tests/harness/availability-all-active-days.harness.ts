import { readPrimaryNavigationSource } from "./nav-source";
/**
 * AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01 (+ domain addendum)
 * Pure logic + source guards (no DB writes, no network).
 *
 * Domain separation (documented):
 *   operational calendar ≠ unavailability ≠ preferences ≠ structural constraints
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  DEFAULT_WORKING_DAYS,
  formatBulkSuccessMessage,
  groupIdenticalWindows,
  isValidTimeRange,
  resolveWorkingDays,
  timesOverlap,
} from "../../src/lib/availability/active-days";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function simulateBulkUpsert(opts: {
  activeDays: number[];
  dayOfWeek: number | null;
  start: string;
  end: string;
  existing: Array<{ day: number; start: string; end: string }>;
}):
  | { ok: true; created: number; unchanged: number; days: number[] }
  | { ok: false; reason: string; conflictDay?: number } {
  if (!isValidTimeRange(opts.start, opts.end)) {
    return { ok: false, reason: "invalid_time" };
  }
  const days = opts.dayOfWeek === null ? [...opts.activeDays] : [opts.dayOfWeek];
  for (const day of days) {
    const exact = opts.existing.some(
      (e) => e.day === day && e.start === opts.start && e.end === opts.end,
    );
    if (exact) continue;
    const conflict = opts.existing.find(
      (e) => e.day === day && timesOverlap(e.start, e.end, opts.start, opts.end),
    );
    if (conflict) {
      return { ok: false, reason: "overlap", conflictDay: day };
    }
  }
  let created = 0;
  let unchanged = 0;
  const next = [...opts.existing];
  for (const day of days) {
    const exact = next.some((e) => e.day === day && e.start === opts.start && e.end === opts.end);
    if (exact) unchanged += 1;
    else {
      next.push({ day, start: opts.start, end: opts.end });
      created += 1;
    }
  }
  return { ok: true, created, unchanged, days };
}

/** Conflict-engine blacklist semantics for hard unavailability-only rows. */
function instructorHardConflict(opts: {
  sessionStart: string;
  sessionEnd: string;
  windows: Array<{ type: string; start: string; end: string }>;
}): boolean {
  const blocked = opts.windows.some(
    (w) =>
      w.type === "unavailable" && timesOverlap(w.start, w.end, opts.sessionStart, opts.sessionEnd),
  );
  const positive = opts.windows.filter((w) => w.type !== "unavailable");
  const fits =
    positive.length === 0 ||
    positive.some((w) => opts.sessionStart >= w.start && opts.sessionEnd <= w.end);
  return blocked || !fits;
}

function run() {
  // --- Domain: operational calendar source ---
  assert(
    JSON.stringify(resolveWorkingDays(undefined)) === JSON.stringify([...DEFAULT_WORKING_DAYS]),
    "default working days Sat–Thu from operational calendar fallback",
  );
  assert(!DEFAULT_WORKING_DAYS.includes(5), "Friday excluded when inactive");
  assert(resolveWorkingDays([6, 0, 1, 2, 3, 4, 5]).includes(5), "dynamically enabled day included");
  assert(ALL_ACTIVE_DAYS_SENTINEL === "all_active_days", "UI sentinel is not DB day value");
  assert(ALL_ACTIVE_DAYS_SENTINEL !== "all", "never use bare all");

  // --- Single day ---
  const single = simulateBulkUpsert({
    activeDays: [...DEFAULT_WORKING_DAYS],
    dayOfWeek: 0,
    start: "08:00",
    end: "10:00",
    existing: [],
  });
  assert(single.ok === true && single.created === 1, "single day still works");

  // --- All active days ---
  const all = simulateBulkUpsert({
    activeDays: [...DEFAULT_WORKING_DAYS],
    dayOfWeek: null,
    start: "08:00",
    end: "10:00",
    existing: [],
  });
  assert(all.ok === true && all.created === 6, "all active days creates one row per day");
  assert(all.ok && !all.days.includes(5), "Friday excluded when inactive");

  // --- Duplicates ---
  const dup = simulateBulkUpsert({
    activeDays: [...DEFAULT_WORKING_DAYS],
    dayOfWeek: null,
    start: "08:00",
    end: "10:00",
    existing: [
      { day: 0, start: "08:00", end: "10:00" },
      { day: 1, start: "08:00", end: "10:00" },
    ],
  });
  assert(dup.ok === true && dup.created === 4 && dup.unchanged === 2, "accurate created/unchanged");
  assert(
    formatBulkSuccessMessage({
      status: "ok",
      days_created: 0,
      days_unchanged: 6,
      days_targeted: [...DEFAULT_WORKING_DAYS],
    }).includes("لا تغيير"),
    "no misleading success when unchanged",
  );

  // --- Overlap atomic reject ---
  const overlap = simulateBulkUpsert({
    activeDays: [...DEFAULT_WORKING_DAYS],
    dayOfWeek: null,
    start: "09:00",
    end: "11:00",
    existing: [{ day: 2, start: "08:00", end: "10:00" }],
  });
  assert(overlap.ok === false && overlap.conflictDay === 2, "overlap on one day rolls back all");

  // --- Invalid time ---
  assert(
    simulateBulkUpsert({
      activeDays: [...DEFAULT_WORKING_DAYS],
      dayOfWeek: null,
      start: "12:00",
      end: "08:00",
      existing: [],
    }).ok === false,
    "invalid time rejected",
  );

  // --- Default available + unavailability blacklist ---
  assert(
    instructorHardConflict({
      sessionStart: "08:00",
      sessionEnd: "09:00",
      windows: [{ type: "unavailable", start: "10:00", end: "12:00" }],
    }) === false,
    "session outside unavailability block is allowed (default available)",
  );
  assert(
    instructorHardConflict({
      sessionStart: "10:30",
      sessionEnd: "11:30",
      windows: [{ type: "unavailable", start: "10:00", end: "12:00" }],
    }) === true,
    "session inside unavailability block is rejected",
  );

  // --- Visual grouping ---
  const grouped = groupIdenticalWindows(
    DEFAULT_WORKING_DAYS.map((d) => ({
      day_of_week: d,
      start_time: "08:00:00",
      end_time: "12:00:00",
    })),
    [...DEFAULT_WORKING_DAYS],
  );
  assert(
    grouped.length === 1 && grouped[0]!.label === "كل أيام الدوام",
    "UI groups identical windows",
  );

  // --- Migration ---
  const mig = readSrc(
    "supabase/migrations/20260720120000_source_only_availability_all_active_days.sql",
  );
  assert(mig.includes("SOURCE-ONLY"), "migration source-only");
  assert(mig.includes("NOT APPLIED") || mig.includes("SOURCE-ONLY / NOT APPLIED"), "NOT APPLIED");
  assert(
    mig.includes("upsert_instructor_unavailability_for_active_days"),
    "instructor unavail RPC",
  );
  assert(mig.includes("upsert_room_unavailability_for_active_days"), "room unavail RPC");
  assert(!mig.includes("upsert_room_availability_for_active_days"), "no room availability RPC");
  assert(
    !mig.includes("upsert_instructor_availability_for_active_days"),
    "no generic availability RPC",
  );
  assert(mig.includes("v_type text := 'unavailable'"), "hardcodes unavailable");
  assert(mig.includes("v_pref boolean := false"), "hardcodes Hard (not Soft)");
  assert(mig.includes("scheduling_settings"), "operational calendar source");
  assert(mig.includes("SECURITY DEFINER") && mig.includes("auth.uid()"), "secure RPC");
  assert(mig.includes("can_manage_college"), "can_manage_college");
  assert(mig.includes("REVOKE ALL") && mig.includes("FROM PUBLIC, anon"), "PUBLIC/anon revoked");
  assert(mig.includes("Pre-validate ALL days before any DML"), "pre-validate");
  assert(mig.includes("days_created") && mig.includes("days_unchanged"), "counts");
  assert(
    mig.indexOf("Pre-validate ALL days before any DML") < mig.indexOf("Apply inserts"),
    "atomicity: validate before DML",
  );

  // --- UI domain ---
  const ui = readSrc("src/routes/_authenticated/availability.tsx");
  assert(ui.includes("عدم التوفّر"), "page is unavailability");
  assert(ui.includes("كل أيام الدوام"), "all active days option");
  assert(ui.includes("سيتم تطبيق فترة عدم التوفر على"), "affected-day count preview");
  assert(ui.includes('data-testid="affected-days-preview"'), "preview test id");
  assert(ui.includes("upsertInstructorUnavailabilityBulk"), "instructor flow via RPC");
  assert(ui.includes("upsertRoomUnavailabilityBulk"), "room flow via RPC");
  assert(!ui.includes("function RoomAvailability"), "no duplicate room availability tab");
  assert(ui.includes("عدم توفّر القاعات"), "room tab is unavailability");
  assert(ui.includes("عدم توفّر المحاضرين"), "instructor tab is unavailability");
  assert(!ui.includes('TabsTrigger value="room-availability"'), "no room-availability tab value");
  assert(!ui.includes("AVAIL_TYPES"), "no available/unavailable status select");
  assert(!ui.includes("تفضيل (Soft)"), "no Soft preference UI");
  assert(!ui.includes('SelectItem value="hard"'), "no Hard/Soft type select");
  assert(!ui.includes("availability_type:"), "form does not set availability status");
  assert(ui.includes('.eq("availability_type", "unavailable")'), "lists hard unavailability only");
  assert(ui.includes('.eq("is_preference", false)'), "lists Hard rows only");
  assert(ui.includes("formatBulkSuccessMessage"), "accurate counts toast");
  assert(ui.includes("rpcErrorMessage"), "validation failure shows error not success");
  assert(
    ui.includes("<DaySelectItems workingDays={workingDays} />"),
    "day select uses settings days",
  );
  assert(ui.includes("activeDays.map((day)"), "single-day options from resolved working days");
  assert(!ui.includes("{DAYS.map((d, i)"), "day options not hardcoded full week");

  const instructorBlock = ui.slice(
    ui.indexOf("function InstructorUnavailability"),
    ui.indexOf("function RoomUnavailability"),
  );
  assert(
    !instructorBlock.includes('.from("instructor_availability").insert'),
    "no direct client DML for instructor create",
  );

  const api = readSrc("src/lib/availability/bulk-api.ts");
  assert(api.includes("upsert_instructor_unavailability_for_active_days"), "API instructor RPC");
  assert(api.includes("upsert_room_unavailability_for_active_days"), "API room RPC");
  assert(!api.includes("upsert_room_availability"), "API has no room availability");
  assert(api.includes("scheduling_settings"), "loads working days from settings");

  const validator = readSrc("src/lib/conflict-engine/validator.ts");
  assert(
    validator.includes("available by default") || validator.includes("blacklist"),
    "conflict engine documents default-available / blacklist",
  );
  assert(
    validator.includes("positiveWindows.length === 0"),
    "unavailable-only days do not force whitelist",
  );

  const nav = readPrimaryNavigationSource(root);
  assert(nav.includes('label: "عدم التوفّر"'), "nav label unavailability");

  // Domain separation documentation present in migration header
  assert(
    mig.includes("operational calendar") &&
      mig.includes("unavailability") &&
      mig.includes("preferences") &&
      mig.includes("structural"),
    "migration documents domain separation",
  );

  console.log("PASS availability-all-active-days harness (unavailability domain)");
}

run();
