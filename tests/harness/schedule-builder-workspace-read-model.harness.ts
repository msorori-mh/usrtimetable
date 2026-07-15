/**
 * Schedule Builder workspace read-model harness (pure logic + source guards).
 * No DB, no network, no migrations, no mutations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEDULE_BUILDER_NAV_LABEL_AR,
  SCHEDULE_BUILDER_NAV_TO,
  shouldLoadWorkspaceCollegeScoped,
  shouldLoadWorkspaceSessions,
  shouldLoadWorkspaceVersions,
} from "../../src/lib/schedule-builder/access";
import { assembleWorkspaceSessionRows } from "../../src/lib/schedule-builder/session-hydrate";
import {
  EMPTY_WORKSPACE_FILTERS,
  buildFilterOptions,
  computeWorkspaceStats,
  filterWorkspaceSessions,
  mapWorkspaceSessions,
  sessionMatchesWorkspaceStudySystem,
  toGridSessions,
  type WorkspaceSessionView,
} from "../../src/lib/schedule-builder/workspace";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function sampleSession(
  partial: Partial<WorkspaceSessionView> & { id: string },
): WorkspaceSessionView {
  return {
    day_of_week: 6,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "lecture",
    study_system: "regular",
    course_code: "CS101",
    course_name: "مقدمة",
    instructor_name: "د. أحمد",
    room_label: "A1",
    section_number: "1",
    subgroup_code: null,
    subgroup_expected_students: null,
    enrollment_count_status: "unverified",
    enrollment_count: null,
    enrollment_count_updated_at: null,
    course_offering_id: null,
    program_name: "علوم حاسب",
    level_name: "الأول",
    department_name: "حاسب",
    instructor_id: "i1",
    section_id: "s1",
    section_subgroup_id: null,
    room_id: "r1",
    program_id: "p1",
    level_id: "l1",
    updated_at: "2026-01-01T00:00:00Z",
    is_locked: false,
    ...partial,
  };
}

function run() {
  // 1. College Guard still effective + nav
  assert(SCHEDULE_BUILDER_NAV_LABEL_AR === "بناء الجدول", "nav label");
  assert(SCHEDULE_BUILDER_NAV_TO === "/schedule-builder", "workspace route");
  const layout = readSrc("src/components/app-layout.tsx");
  assert(layout.includes('to: "/schedule-builder"'), "layout points to workspace");
  assert(layout.includes('label: "بناء الجدول"'), "layout label");

  // 2. No data load before valid college
  assert(shouldLoadWorkspaceCollegeScoped(false) === false, "no college → no load");
  assert(shouldLoadWorkspaceCollegeScoped(true) === true, "college → can load terms");
  assert(
    shouldLoadWorkspaceVersions({ hasActiveCollege: false, termId: "t1" }) === false,
    "no college → no versions",
  );
  assert(
    shouldLoadWorkspaceVersions({ hasActiveCollege: true, termId: null }) === false,
    "no term → no versions",
  );
  assert(
    shouldLoadWorkspaceVersions({ hasActiveCollege: true, termId: "t1" }) === true,
    "college+term → versions",
  );

  // 3–4. Term gates versions; version gates sessions
  assert(
    shouldLoadWorkspaceSessions({
      hasActiveCollege: true,
      termId: "t1",
      versionId: null,
    }) === false,
    "no version → no sessions",
  );
  assert(
    shouldLoadWorkspaceSessions({
      hasActiveCollege: true,
      termId: "t1",
      versionId: "v1",
    }) === true,
    "college+term+version → sessions",
  );

  // 5–6. Study system scoping (client mirror of server filter)
  assert(
    sessionMatchesWorkspaceStudySystem("regular", "regular") === true,
    "regular matches regular",
  );
  assert(
    sessionMatchesWorkspaceStudySystem("parallel", "regular") === false,
    "parallel not in regular",
  );
  assert(
    sessionMatchesWorkspaceStudySystem("regular", "parallel") === false,
    "regular not in parallel",
  );
  assert(
    sessionMatchesWorkspaceStudySystem("parallel", "parallel") === true,
    "parallel matches parallel",
  );
  assert(sessionMatchesWorkspaceStudySystem("both", "regular") === true, "both in regular");
  assert(sessionMatchesWorkspaceStudySystem("both", "parallel") === true, "both in parallel");

  // Query source: applyStudySystemFilter used in fetchWorkspaceSessions
  const queriesSrc = readSrc("src/lib/schedule-builder/queries.ts");
  assert(
    queriesSrc.includes("applyStudySystemFilter"),
    "sessions query applies study system filter",
  );
  assert(queriesSrc.includes('.eq("college_id"'), "queries college scoped");
  assert(queriesSrc.includes("schedule_version_id"), "sessions scoped to version");
  assert(
    queriesSrc.includes("WORKSPACE_SESSION_FLAT_SELECT"),
    "sessions use flat select (no PostgREST embeds)",
  );
  assert(
    queriesSrc.includes("assembleWorkspaceSessionRows") || queriesSrc.includes("session-hydrate"),
    "client-side hydration assembles relation labels",
  );
  const hydrateSrc = readSrc("src/lib/schedule-builder/session-hydrate.ts");
  assert(
    hydrateSrc.includes("export function assembleWorkspaceSessionRows"),
    "pure hydrate module exports assemble",
  );
  assert(
    !queriesSrc.includes("course_offerings(") &&
      !queriesSrc.includes("instructors(") &&
      !queriesSrc.includes("rooms(") &&
      !queriesSrc.includes("sections("),
    "queries must not use PGRST200-prone embeds on schedule_sessions",
  );
  assert(!/\.insert\s*\(/.test(queriesSrc), "queries: no insert");
  assert(!/\.update\s*\(/.test(queriesSrc), "queries: no update");
  assert(!/\.delete\s*\(/.test(queriesSrc), "queries: no delete");

  // Pure assemble: missing lookups → null relations (mapper shows dashes)
  const assembled = assembleWorkspaceSessionRows(
    [
      {
        id: "sess-1",
        day_of_week: 0,
        start_time: "08:00:00",
        end_time: "10:00:00",
        session_type: "lecture",
        study_system: "regular",
        section_id: "sec-1",
        instructor_id: "ins-1",
        room_id: "room-missing",
        updated_at: null,
        is_locked: false,
        course_offering_id: "off-1",
      },
    ],
    {
      offerings: new Map([
        [
          "off-1",
          {
            id: "off-1",
            program_id: "prog-1",
            level_id: "lvl-1",
            course_id: "course-1",
          },
        ],
      ]),
      courses: new Map([
        [
          "course-1",
          {
            id: "course-1",
            name: "برمجة",
            code: "CS101",
            department_id: "dept-1",
          },
        ],
      ]),
      departments: new Map([["dept-1", { id: "dept-1", name: "علوم الحاسوب" }]]),
      programs: new Map([["prog-1", { id: "prog-1", name: "IT" }]]),
      levels: new Map([["lvl-1", { id: "lvl-1", name: "1", level_number: 1 }]]),
      sections: new Map([["sec-1", { id: "sec-1", section_number: "A" }]]),
      subgroups: new Map(),
      instructors: new Map([["ins-1", { id: "ins-1", full_name: "د. أحمد" }]]),
      rooms: new Map(), // orphan room_id → null rooms relation
    },
  );
  assert(assembled[0].course_offerings?.courses?.code === "CS101", "assemble course code");
  assert(assembled[0].instructors?.full_name === "د. أحمد", "assemble instructor");
  assert(assembled[0].rooms == null, "orphan room stays null (no silent fake room)");
  const mappedAssembled = mapWorkspaceSessions(assembled);
  assert(mappedAssembled[0].room_label === "—", "orphan room maps to dash");
  assert(mappedAssembled[0].course_code === "CS101", "assembled course maps");

  // Map raw → view; partial data does not throw
  const mapped = mapWorkspaceSessions([
    {
      id: "a",
      day_of_week: 0,
      start_time: "09:00:00",
      end_time: "10:00:00",
      session_type: "lab",
      study_system: "parallel",
      instructor_id: null,
      section_id: null,
      room_id: null,
      course_offerings: null,
      instructors: null,
      rooms: null,
      sections: null,
    },
  ]);
  assert(mapped.length === 1, "maps one session");
  assert(mapped[0].instructor_name === "—", "missing instructor → dash");
  assert(mapped[0].room_label === "—", "missing room → dash");
  assert(mapped[0].course_code === "—", "missing course → dash");

  // Filters are local only
  const sessions = [
    sampleSession({ id: "1", instructor_id: "i1", session_type: "lecture" }),
    sampleSession({
      id: "2",
      instructor_id: "i2",
      instructor_name: "د. سارة",
      session_type: "lab",
      room_id: "r2",
      room_label: "Lab1",
    }),
  ];
  const filtered = filterWorkspaceSessions(sessions, {
    ...EMPTY_WORKSPACE_FILTERS,
    instructor: "i1",
  });
  assert(filtered.length === 1 && filtered[0].id === "1", "instructor filter works");
  const none = filterWorkspaceSessions(sessions, {
    ...EMPTY_WORKSPACE_FILTERS,
    room: "missing",
  });
  assert(none.length === 0, "filter empty result");

  const stats = computeWorkspaceStats(sessions);
  assert(stats.totalSessions === 2, "stats total");
  assert(stats.lectureCount === 1, "stats lecture");
  assert(stats.labCount === 1, "stats lab");
  assert(stats.instructorCount === 2, "stats instructors");
  assert(stats.roomCount === 2, "stats rooms");

  const opts = buildFilterOptions(sessions);
  assert(opts.instructors.length === 2, "filter options instructors");
  assert(opts.sessionTypes.length === 2, "filter options types");

  const grid = toGridSessions(sessions);
  assert(grid[0].title.includes("CS101"), "grid title has course code");
  assert(!!grid[0].badge, "grid has type/system badge");

  // Page source guards
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  assert(page.includes("shouldLoadWorkspaceCollegeScoped"), "page uses college guard");
  assert(page.includes("enabled: canLoadCollege"), "terms gated on college");
  assert(page.includes("canLoadVersions"), "versions gated");
  assert(page.includes("canLoadSessions"), "sessions gated");
  assert(page.includes('queryKey: ["schedule-builder", "terms", collegeId]'), "terms query key");
  assert(
    page.includes('queryKey: ["schedule-builder", "versions", collegeId, termId]'),
    "versions query key",
  );
  assert(
    page.includes('queryKey: ["schedule-builder", "sessions", collegeId, versionId, studySystem]'),
    "sessions query key includes study system",
  );
  assert(page.includes("إعادة تعيين المرشحات"), "reset filters button");
  assert(page.includes("SessionDetailsSheet"), "details sheet wired");
  assert(
    page.includes("draggable={editModeActive && mayEnterEdit}"),
    "grid drag only in edit mode",
  );
  assert(page.includes("onDropAt={onGridDrop}"), "drop creates pending only");
  assert(!page.includes("useMutation"), "page: no useMutation");
  assert(!/\.insert\s*\(/.test(page), "page: no insert");
  assert(!/\.update\s*\(/.test(page), "page: no update");
  assert(!/\.delete\s*\(/.test(page), "page: no delete");
  assert(
    !/runScheduler|invokeScheduler|generateSchedule|publishVersion|unpublish|cloneVersion/i.test(
      page,
    ),
    "no scheduler/publish/clone",
  );
  assert(!/>حفظ</.test(page) && !page.includes('"حفظ"'), "no save button");
  assert(!/>حذف</.test(page) && !page.includes('"حذف"'), "no delete button");
  assert(!/>نشر</.test(page) && !page.includes('"نشر"'), "no publish button");
  assert(!/>تعديل</.test(page), "no edit button");

  const sheet = readSrc("src/components/schedule-builder/session-details-sheet.tsx");
  assert(sheet.includes("إغلاق"), "sheet has close");
  assert(!/>حفظ</.test(sheet), "sheet: no save button");
  assert(!/>تعديل</.test(sheet), "sheet: no edit button");
  assert(!/>حذف</.test(sheet), "sheet: no delete button");
  assert(!/>نشر</.test(sheet), "sheet: no publish button");
  assert(
    !/Scheduler|scheduler|useMutation|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(sheet),
    "sheet: no writes/scheduler",
  );

  // Empty / error copy present
  assert(
    page.includes("SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR") || page.includes("لا توجد نسخ"),
    "empty versions",
  );
  assert(
    page.includes("SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR") ||
      page.includes("لا تحتوي على جلسات"),
    "empty sessions",
  );
  assert(page.includes("فشل تحميل"), "error state");

  // No migrations in this phase folder / no migration files touched by impl paths
  assert(!queriesSrc.includes("migration"), "queries not migration");

  console.log("schedule-builder-workspace-read-model harness: PASS");
}

run();
