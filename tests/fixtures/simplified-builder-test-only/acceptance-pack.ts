/**
 * Deterministic, synthetic acceptance fixtures for the simplified timetable flow.
 *
 * These values are source-only. They never create Auth users, call Lovable Cloud,
 * or write to a database. The `.invalid` domain intentionally cannot receive mail.
 */

export const TEST_ONLY_MARKER = "TEST_ONLY_USRTIMETABLE_SIMPLIFIED_03" as const;

export type TestOnlyRole = "super_admin" | "college_admin" | "read_only";

export type TestOnlyCapability =
  | "manage_users"
  | "manage_all_colleges"
  | "edit_selected_college"
  | "create_session"
  | "validate_change"
  | "save_change";

export interface TestOnlyAccount {
  id: string;
  marker: typeof TEST_ONLY_MARKER;
  displayName: string;
  email: string;
  role: TestOnlyRole;
  collegeIds: string[];
  capabilities: Record<TestOnlyCapability, boolean>;
}

export const testOnlyCollege = {
  id: "7e570000-0000-4000-8000-000000000001",
  marker: TEST_ONLY_MARKER,
  code: "TEST03",
  name: "كلية اختبار تبسيط الجداول",
} as const;

const managerCapabilities: Record<TestOnlyCapability, boolean> = {
  manage_users: false,
  manage_all_colleges: false,
  edit_selected_college: true,
  create_session: true,
  validate_change: true,
  save_change: true,
};

export const testOnlyAccounts: readonly TestOnlyAccount[] = [
  {
    id: "7e570000-0000-4000-8000-000000000011",
    marker: TEST_ONLY_MARKER,
    displayName: "TEST ONLY — مدير المؤسسة",
    email: "usr-timetable-super-03@test-only.invalid",
    role: "super_admin",
    collegeIds: [],
    capabilities: {
      ...managerCapabilities,
      manage_users: true,
      manage_all_colleges: true,
    },
  },
  {
    id: "7e570000-0000-4000-8000-000000000012",
    marker: TEST_ONLY_MARKER,
    displayName: "TEST ONLY — مدير كلية",
    email: "usr-timetable-college-03@test-only.invalid",
    role: "college_admin",
    collegeIds: [testOnlyCollege.id],
    capabilities: { ...managerCapabilities },
  },
  {
    id: "7e570000-0000-4000-8000-000000000013",
    marker: TEST_ONLY_MARKER,
    displayName: "TEST ONLY — مشاهد",
    email: "usr-timetable-viewer-03@test-only.invalid",
    role: "read_only",
    collegeIds: [testOnlyCollege.id],
    capabilities: {
      manage_users: false,
      manage_all_colleges: false,
      edit_selected_college: false,
      create_session: false,
      validate_change: false,
      save_change: false,
    },
  },
] as const;

export const testOnlySchedule = {
  marker: TEST_ONLY_MARKER,
  version: {
    id: "7e570000-0000-4000-8000-000000000021",
    collegeId: testOnlyCollege.id,
    name: "TEST ONLY — مسودة قبول الواجهة المبسطة",
    status: "draft" as const,
    disposableTest: true,
  },
  sessions: [
    {
      id: "7e570000-0000-4000-8000-000000000031",
      courseCode: "TEST101",
      courseName: "مقرر اختبار نظري",
      day: "sunday",
      startsAt: "08:00",
      endsAt: "10:00",
      roomCode: "TEST-R01",
      expectedStudents: 30,
      roomCapacity: 40,
    },
  ],
  unscheduledItems: [
    {
      id: "7e570000-0000-4000-8000-000000000041",
      courseCode: "TEST102",
      courseName: "مقرر اختبار عملي",
      reason: "لا توجد جلسة مجدولة بعد",
      canCreateSession: true,
    },
  ],
} as const;

export const simplifiedAcceptanceFlow = [
  "select_context",
  "review_week_grid",
  "open_unscheduled_work",
  "apply_local_change",
  "validate_conflicts",
  "save_safe_change",
] as const;

/** Exact targets only; consumers must never widen these to marker-less deletes. */
export const exactCleanupTargets = {
  authUserIds: testOnlyAccounts.map((account) => account.id),
  collegeIds: [testOnlyCollege.id],
  scheduleVersionIds: [testOnlySchedule.version.id],
  scheduleSessionIds: testOnlySchedule.sessions.map((session) => session.id),
  unscheduledItemIds: testOnlySchedule.unscheduledItems.map((item) => item.id),
} as const;
