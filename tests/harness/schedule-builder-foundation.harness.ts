/**
 * Schedule Builder foundation harness (pure logic + source guards).
 * No DB, no network, no migrations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR,
  SCHEDULE_BUILDER_DEFAULT_END_HOUR,
  SCHEDULE_BUILDER_DEFAULT_START_HOUR,
  SCHEDULE_BUILDER_NAV_LABEL_AR,
  SCHEDULE_BUILDER_NAV_TO,
  isScheduleVersionInActiveCollege,
  isScheduleVersionWriteLocked,
  isSessionDialogReadOnly,
  resolveTimetableGridHours,
  shouldLoadScheduleBuilderData,
} from "../../src/lib/schedule-builder/access";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  // --- Navigation ---
  assert(SCHEDULE_BUILDER_NAV_LABEL_AR === "بناء الجدول", "nav label");
  assert(SCHEDULE_BUILDER_NAV_TO === "/schedule-versions", "nav targets versions (no fixed version id)");
  const layout = readSrc("src/components/app-layout.tsx");
  assert(layout.includes('label: "بناء الجدول"'), "layout has بناء الجدول");
  assert(
    /label:\s*"بناء الجدول"[\s\S]*?to:\s*"\/schedule-versions"|to:\s*"\/schedule-versions"[\s\S]*?label:\s*"بناء الجدول"/.test(
      layout,
    ) || (layout.includes('label: "بناء الجدول"') && layout.includes('to: "/schedule-versions"')),
    "nav entry points at /schedule-versions",
  );

  // --- College mismatch / load gate ---
  assert(
    isScheduleVersionInActiveCollege({ college_id: "c1" }, "c1") === true,
    "college match true",
  );
  assert(
    isScheduleVersionInActiveCollege({ college_id: "c1" }, "c2") === false,
    "college mismatch false",
  );
  assert(isScheduleVersionInActiveCollege(null, "c1") === false, "null version no match");
  assert(
    shouldLoadScheduleBuilderData({
      hasActiveCollege: true,
      versionLoaded: true,
      collegeMatches: true,
    }) === true,
    "load when matched",
  );
  assert(
    shouldLoadScheduleBuilderData({
      hasActiveCollege: true,
      versionLoaded: true,
      collegeMatches: false,
    }) === false,
    "no load on mismatch",
  );
  assert(
    shouldLoadScheduleBuilderData({
      hasActiveCollege: true,
      versionLoaded: false,
      collegeMatches: false,
    }) === false,
    "no load before version ready",
  );
  assert(
    SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR.includes("الكلية النشطة"),
    "mismatch message arabic",
  );

  const page = readSrc("src/routes/_authenticated/timetable.$versionId.tsx");
  assert(page.includes("shouldLoadScheduleBuilderData"), "page uses load gate");
  assert(page.includes("isScheduleVersionInActiveCollege"), "page uses college guard");
  assert(page.includes("SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR"), "page shows mismatch message");
  assert(page.includes("enabled: canLoadData"), "sessions/lookups gated by canLoadData");
  assert(!page.includes("enabled: !!active,"), "must not load on active alone");

  // --- Session dialog read-only ---
  assert(
    isSessionDialogReadOnly({ canManageRole: false, versionStatus: "draft" }) === true,
    "read_only role → dialog RO",
  );
  assert(
    isSessionDialogReadOnly({ canManageRole: true, versionStatus: "published" }) === true,
    "published → dialog RO",
  );
  assert(
    isSessionDialogReadOnly({ canManageRole: true, versionStatus: "archived" }) === true,
    "archived → dialog RO",
  );
  assert(
    isSessionDialogReadOnly({ canManageRole: true, versionStatus: "draft" }) === false,
    "draft + manager → editable",
  );
  assert(isScheduleVersionWriteLocked("published") === true, "published locked");
  assert(isScheduleVersionWriteLocked("archived") === true, "archived locked");
  assert(isScheduleVersionWriteLocked("draft") === false, "draft not locked");

  const dialog = readSrc("src/components/timetable/session-dialog.tsx");
  assert(dialog.includes("readOnly"), "SessionDialog has readOnly prop");
  assert(dialog.includes("canMutate"), "SessionDialog gates mutations");
  assert(dialog.includes("العرض للقراءة فقط"), "RO copy present");
  assert(/\{canMutate && \(\s*<Button[^>]*حفظ/.test(dialog) || dialog.includes("{canMutate && (") && dialog.includes("حفظ"), "save hidden when RO");

  assert(page.includes("readOnly={dialogReadOnly}"), "page passes readOnly");
  assert(page.includes("isSessionDialogReadOnly"), "page uses dialog RO helper");

  // --- Hours: fallback 14, configured settings, no 20 fallback ---
  assert(SCHEDULE_BUILDER_DEFAULT_START_HOUR === 8, "default start 8");
  assert(SCHEDULE_BUILDER_DEFAULT_END_HOUR === 14, "default end 14");
  const fallback = resolveTimetableGridHours({ settings: null, templates: [] });
  assert(fallback.startHour === 8 && fallback.endHour === 14, "fallback 08–14");

  const configured = resolveTimetableGridHours({
    settings: { day_start_time: "08:00", day_end_time: "14:00" },
    templates: [],
  });
  assert(configured.startHour === 8 && configured.endHour === 14, "configured 08–14");

  const custom = resolveTimetableGridHours({
    settings: { day_start_time: "09:00", day_end_time: "13:00" },
    templates: [],
  });
  assert(custom.startHour === 9 && custom.endHour === 13, "configured custom hours");

  const fromTpl = resolveTimetableGridHours({
    settings: null,
    templates: [
      { start_time: "08:00", end_time: "10:00" },
      { start_time: "10:00", end_time: "14:00" },
    ],
  });
  assert(fromTpl.startHour === 8 && fromTpl.endHour === 14, "templates derive hours");

  assert(page.includes("resolveTimetableGridHours"), "page uses hours helper");
  assert(!page.includes(": 20"), "page must not fallback to hour 20");
  assert(!/endHour[^\n]*20/.test(page), "no endHour 20 residue");

  console.log("schedule-builder-foundation harness: PASS");
}

run();
