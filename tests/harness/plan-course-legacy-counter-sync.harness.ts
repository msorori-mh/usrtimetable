/**
 * SOURCE-ONLY PLAN COURSE LEGACY COUNTER SYNC — E2E FIX 02
 * Pure math + static UI wiring assertions (no DB, no network).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLegacyCounterUpdate,
  countersDiffer,
  deriveLegacyCounters,
  pickSessionDuration,
  LEGACY_SYNC_PARTIAL_ERROR_AR,
  DEFAULT_SESSION_DURATION,
} from "@/lib/academic-delivery/plan-course-editor";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ui = readFileSync(join(root, "src/components/study-plans/plan-courses-manager.tsx"), "utf8");

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

const zero = {
  lectures_per_week: 0,
  lecture_session_duration: 2,
  labs_per_week: 0,
  lab_session_duration: 2,
};

// 1) The exact production case: theory 2h + practical 2h => 1 session each.
const e2e = deriveLegacyCounters(
  [
    { component_type: "theory", weekly_contact_hours: 2, is_timetabled: true },
    { component_type: "practical", weekly_contact_hours: 2, is_timetabled: true },
  ],
  zero,
);
assert(e2e.lectures_per_week === 1, "theory 2h with 2h sessions => 1 lecture/week");
assert(e2e.labs_per_week === 1, "practical 2h with 2h sessions => 1 lab/week");
assert(e2e.lecture_session_duration === 2 && e2e.lab_session_duration === 2, "durations preserved");

// 2) Multi-session and odd hours.
assert(
  deriveLegacyCounters([{ component_type: "theory", weekly_contact_hours: 4 }], zero)
    .lectures_per_week === 2,
  "4h theory => 2 lectures of 2h",
);
const odd = deriveLegacyCounters([{ component_type: "theory", weekly_contact_hours: 3 }], zero);
assert(
  odd.lectures_per_week === 1 && odd.lecture_session_duration === 3,
  "3h theory => single 3h session (exact division only)",
);
const five = deriveLegacyCounters([{ component_type: "theory", weekly_contact_hours: 5 }], zero);
assert(
  five.lectures_per_week * five.lecture_session_duration === 5,
  "counters must always multiply back to the weekly hours",
);

// 3) tutorial folds into lectures; non-timetabled hours are excluded.
assert(
  deriveLegacyCounters(
    [
      { component_type: "theory", weekly_contact_hours: 2 },
      { component_type: "tutorial", weekly_contact_hours: 2 },
    ],
    zero,
  ).lectures_per_week === 2,
  "tutorial hours count toward lectures",
);
assert(
  deriveLegacyCounters(
    [{ component_type: "practical", weekly_contact_hours: 4, is_timetabled: false }],
    zero,
  ).labs_per_week === 0,
  "non-timetabled components contribute no counters",
);
assert(
  deriveLegacyCounters(
    [{ component_type: "summer_training", weekly_contact_hours: 6, is_timetabled: false }],
    zero,
  ).lectures_per_week === 0,
  "summer training must not become lectures",
);

// 4) Delete / empty behaviour: counters go to zero but durations stay valid (>0).
const emptied = deriveLegacyCounters([], {
  lectures_per_week: 1,
  lecture_session_duration: 2,
  labs_per_week: 1,
  lab_session_duration: 3,
});
assert(
  emptied.lectures_per_week === 0 && emptied.labs_per_week === 0,
  "removing all components zeroes the counters",
);
assert(
  emptied.lecture_session_duration === 2 && emptied.lab_session_duration === 3,
  "existing session durations are preserved when hours drop to zero",
);
assert(
  deriveLegacyCounters([], null).lecture_session_duration === DEFAULT_SESSION_DURATION,
  "missing duration falls back to the default, never 0 (readiness reads it)",
);
assert(pickSessionDuration(0, 0) === DEFAULT_SESSION_DURATION, "zero hours => default duration");
assert(pickSessionDuration(2, 2) === 2, "current duration preferred when it divides exactly");

// 5) Update payload touches only the four legacy columns.
const payload = buildLegacyCounterUpdate(e2e);
assert(
  JSON.stringify(Object.keys(payload).sort()) ===
    JSON.stringify(
      [
        "lab_session_duration",
        "labs_per_week",
        "lecture_session_duration",
        "lectures_per_week",
      ].sort(),
    ),
  "counter update payload must not disturb unrelated fields",
);

// 6) No-op detection avoids pointless writes.
assert(!countersDiffer(e2e, e2e), "identical counters must not trigger a write");
assert(countersDiffer(zero, e2e), "stale zero counters must trigger a write");

// 7) UI wiring: sync after every component mutation, explicit action, exact scoping.
assert(ui.includes("syncLegacyCounters"), "manager must call the sync helper");
assert(
  ui.includes("مزامنة بيانات الجدولة"),
  "explicit Arabic sync action required for legacy rows",
);
assert(ui.includes("plan-course-sync-counters-"), "sync button needs a stable testid");
assert(
  (ui.match(/await syncLegacyCounters\(/g) ?? []).length >= 4,
  "generate + add + update + delete component must all sync counters",
);
assert(
  ui.includes("buildLegacyCounterUpdate"),
  "counter write must use the restricted payload builder",
);
assert(
  ui.includes('.eq("id", scope.id)') &&
    ui.includes('.eq("college_id", scope.collegeId)') &&
    ui.includes('.eq("study_plan_id", scope.studyPlanId)'),
  "counter sync must be scoped by plan_course id + college + study plan",
);
assert(
  ui.includes("planCourseUpdateScope(ctx, row)"),
  "counter sync must fail closed on scope mismatch",
);
assert(
  ui.includes("LEGACY_SYNC_PARTIAL_ERROR_AR"),
  "partial failure must surface an explicit actionable error",
);
assert(
  /onError: \(e: Error\) => \{\s*toast\.error\(e\.message\);\s*invalidate\(\);/.test(ui),
  "failed sync must refetch instead of claiming success",
);
assert(
  LEGACY_SYNC_PARTIAL_ERROR_AR.includes("مزامنة بيانات الجدولة"),
  "error names the retry action",
);
assert(!/supabaseAdmin|service_role/.test(ui), "no privileged client in the manager");

if (failures > 0) {
  console.error(`PLAN_COURSE_LEGACY_COUNTER_SYNC harness: ${failures} failed assertion(s)`);
  process.exit(1);
}
console.log("PLAN_COURSE_LEGACY_COUNTER_SYNC_E2E_FIX_02 harness: all assertions passed");
