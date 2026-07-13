/**
 * Schedule Builder local edit state/UI harness (Phase A).
 * Pure logic + source guards. No DB, no network, no mutations.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canEnterEditMode,
  canOpenSessionForLocalEdit,
  editModeBlockedReason,
  SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_LOCAL_ONLY_NOTICE_AR,
  SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR,
  SCHEDULE_BUILDER_UNSAVED_BADGE_AR,
  SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR,
} from "../../src/lib/schedule-builder/edit-access";
import {
  applyPendingToSessions,
  buildBeforeAfterRows,
  buildPendingChange,
  formValuesFromSession,
  hasPendingChanges,
  normalizeTimeHHMM,
  snapshotOriginalFromSession,
  toGridSessionsWithPending,
  validateLocalEditForm,
  type PendingScheduleSessionChange,
} from "../../src/lib/schedule-builder/pending-change";
import type { WorkspaceSessionView } from "../../src/lib/schedule-builder/workspace";

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
    room_label: "A1 — قاعة",
    section_number: "1",
    program_name: "علوم حاسب",
    level_name: "الأول",
    department_name: "حاسب",
    instructor_id: "i1",
    section_id: "s1",
    room_id: "r1",
    program_id: "p1",
    level_id: "l1",
    updated_at: "2026-07-01T12:00:00.000Z",
    is_locked: false,
    ...partial,
  };
}

function forbidWritePatterns(src: string, label: string, opts?: { allowSessionMoveRpc?: boolean }) {
  assert(!src.includes(".insert("), `${label}: no insert`);
  assert(!src.includes(".update("), `${label}: no update`);
  assert(!src.includes(".delete("), `${label}: no delete`);
  assert(!src.includes(".upsert("), `${label}: no upsert`);
  if (opts?.allowSessionMoveRpc) {
    const stripped = src
      .replace(/\.rpc\(\s*"validate_schedule_session_move"/g, ".RPC_OK(")
      .replace(/\.rpc\(\s*"move_or_reschedule_schedule_session"/g, ".RPC_OK(");
    // Page may import helpers that call rpc; still forbid direct table writes above.
    assert(!/\.rpc\s*\(/.test(stripped), `${label}: only session-move rpcs allowed`);
  } else {
    assert(!/\.rpc\s*\(/.test(src), `${label}: no rpc`);
  }
  assert(!src.includes("mutationFn"), `${label}: no mutationFn`);
  assert(!src.includes("useMutation"), `${label}: no useMutation`);
  assert(!src.includes("run_auto_schedule"), `${label}: no auto-schedule`);
  assert(!src.includes("auto-schedule"), `${label}: no auto-schedule route invoke`);
}

function run() {
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  const editAccess = readSrc("src/lib/schedule-builder/edit-access.ts");
  const pendingSrc = readSrc("src/lib/schedule-builder/pending-change.ts");
  const editSheet = readSrc("src/components/schedule-builder/session-edit-sheet.tsx");
  const unsavedDlg = readSrc("src/components/schedule-builder/unsaved-local-changes-dialog.tsx");
  const detailsSheet = readSrc("src/components/schedule-builder/session-details-sheet.tsx");
  const queries = readSrc("src/lib/schedule-builder/queries.ts");

  // 1. read_only does not see edit mode control (button gated by canManageRole)
  assert(page.includes("canManageRole"), "page uses canManageRole");
  assert(page.includes("useCanManageActiveCollege"), "page uses manage hook");
  assert(
    page.includes("{canManageRole ? (") || page.includes("canManageRole ?"),
    "edit button wrapped by canManageRole",
  );

  // 2. Unauthorized cannot enable logically
  assert(
    canEnterEditMode({
      canManageRole: false,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "draft",
    }) === false,
    "read_only cannot enter edit",
  );
  assert(
    editModeBlockedReason({
      canManageRole: false,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "draft",
    }) !== null,
    "blocked reason for read_only",
  );

  // 3. college_admin (canManage) + editable version
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "draft",
    }) === true,
    "manager + draft can enter",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "review",
    }) === true,
    "manager + review can enter",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "approved",
    }) === true,
    "manager + approved can enter",
  );

  // 4–5. published / archived not editable
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "published",
    }) === false,
    "published not editable",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "archived",
    }) === false,
    "archived not editable",
  );
  assert(
    page.includes(SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR) ||
      page.includes("SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR"),
    "published/archived notice wired",
  );

  // No version / no college
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: false,
      versionId: "v1",
      versionStatus: "draft",
    }) === false,
    "no college blocks edit",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: null,
      versionStatus: "draft",
    }) === false,
    "no version blocks edit",
  );

  // 6. Enabling edit mode has no mutation in page
  assert(
    page.includes(SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR) ||
      page.includes("SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR"),
    "enter edit label",
  );
  assert(
    page.includes(SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR) ||
      page.includes("SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR"),
    "exit edit label",
  );
  forbidWritePatterns(page, "schedule-builder page", { allowSessionMoveRpc: true });
  forbidWritePatterns(editAccess, "edit-access");
  forbidWritePatterns(pendingSrc, "pending-change");
  forbidWritePatterns(editSheet, "session-edit-sheet", { allowSessionMoveRpc: true });
  forbidWritePatterns(unsavedDlg, "unsaved dialog");

  // 7–8. View → details; Edit → edit sheet
  assert(page.includes("SessionDetailsSheet"), "details sheet present");
  assert(page.includes("SessionEditSheet"), "edit sheet present");
  assert(page.includes("editModeActive"), "edit mode state");
  assert(detailsSheet.includes("عرض فقط"), "details remain read-only");

  // 9. Single selected session
  assert(page.includes("selectedSessionId"), "single selected session id");
  assert(page.includes("setPending"), "pending state");

  // 10–11. No instructor / course / section / type editors in edit sheet
  assert(!editSheet.includes('htmlFor="edit-instructor"'), "no instructor field");
  assert(!editSheet.includes("تغيير المدرس"), "no instructor change copy");
  assert(editSheet.includes("بيانات ثابتة"), "readonly block present");
  assert(editSheet.includes("المدرس"), "instructor shown read-only");
  assert(editSheet.includes("الشعبة"), "section read-only");
  assert(editSheet.includes("نوع الجلسة"), "type read-only");

  // 12–14. Local day/time/room fields
  assert(editSheet.includes('htmlFor="edit-day"') || editSheet.includes("اليوم"), "day field");
  assert(editSheet.includes("وقت البداية"), "start time field");
  assert(editSheet.includes("وقت النهاية"), "end time field");
  assert(editSheet.includes("القاعة"), "room field");
  assert(editSheet.includes("تطبيق محليًا"), "apply local button");
  assert(!editSheet.includes("حفظ التغييرات"), "no generic save-all wording");
  assert(!editSheet.includes("تم الحفظ"), "no saved copy");

  const session = sampleSession({ id: "sess-1" });
  const rooms = [
    { id: "r1", code: "A1", name: "قاعة" },
    { id: "r2", code: "B2", name: "معمل" },
  ];

  // Opening form alone is not a pending change
  const form = formValuesFromSession(session);
  assert(hasPendingChanges(null) === false, "null pending = no changes");
  const identical = validateLocalEditForm(form, snapshotOriginalFromSession(session));
  assert(identical.ok === false, "identical values rejected");

  // 15. expectedUpdatedAt captured
  const dayChange = validateLocalEditForm(
    { ...form, day_of_week: 0 },
    snapshotOriginalFromSession(session),
  );
  assert(dayChange.ok === true, "day change valid");
  if (!dayChange.ok) throw new Error("unreachable");
  const pendingDay = buildPendingChange({
    session,
    proposed: dayChange.proposed,
    changeReason: "",
  });
  assert(pendingDay.expectedUpdatedAt === session.updated_at, "expectedUpdatedAt captured");
  assert(hasPendingChanges(pendingDay) === true, "day pending detected");

  // 16. end before start rejected
  const badTime = validateLocalEditForm(
    { ...form, start_time: "10:00", end_time: "09:00" },
    snapshotOriginalFromSession(session),
  );
  assert(badTime.ok === false, "end before start rejected");

  // 17. identical does not create pending (already asserted)

  // 12 continued: day local apply → display derived
  const displayed = applyPendingToSessions([session], pendingDay, rooms);
  assert(displayed[0].day_of_week === 0, "display day updated locally");
  assert(session.day_of_week === 6, "original session object unchanged");
  assert(allSessionsUnchangedConcept(session, pendingDay), "query source conceptually intact");

  // 13. time local
  const timeOk = validateLocalEditForm(
    { ...form, start_time: "09:00", end_time: "11:00" },
    snapshotOriginalFromSession(session),
  );
  assert(timeOk.ok === true, "time change valid");
  if (!timeOk.ok) throw new Error("unreachable");
  const pendingTime = buildPendingChange({
    session,
    proposed: timeOk.proposed,
    changeReason: "اختبار",
  });
  const withTime = applyPendingToSessions([session], pendingTime, rooms);
  assert(normalizeTimeHHMM(withTime[0].start_time) === "09:00", "start applied locally");
  assert(normalizeTimeHHMM(withTime[0].end_time) === "11:00", "end applied locally");

  // 14. room local
  const roomOk = validateLocalEditForm(
    { ...form, room_id: "r2" },
    snapshotOriginalFromSession(session),
  );
  assert(roomOk.ok === true, "room change valid");
  if (!roomOk.ok) throw new Error("unreachable");
  const pendingRoom = buildPendingChange({
    session,
    proposed: roomOk.proposed,
    changeReason: "",
  });
  const withRoom = applyPendingToSessions([session], pendingRoom, rooms);
  assert(withRoom[0].room_id === "r2", "room applied locally");
  assert(withRoom[0].room_label.includes("B2"), "room label derived");

  // 18. unsaved badge on grid
  const grid = toGridSessionsWithPending([withRoom[0]], pendingRoom, "sess-1");
  assert(
    grid[0].badge?.includes(SCHEDULE_BUILDER_UNSAVED_BADGE_AR) === true,
    "unsaved badge on pending session",
  );
  assert(grid[0].badge?.includes("محدد") === true, "selected marker not color-only");

  // 19. original data not treated as saved via optimistic cache rewrite
  assert(!page.includes("queryClient.setQueryData"), "no query cache mutation");
  assert(
    page.includes("invalidateQueries") && page.includes("moveOrRescheduleScheduleSession"),
    "invalidate only after RPC save path",
  );

  // 20. cancel restores — clearing pending returns original display
  const cleared = applyPendingToSessions([session], null, rooms);
  assert(
    cleared[0].day_of_week === 6 && cleared[0].room_id === "r1",
    "cancel restores original display",
  );

  // 21–22. exit with pending shows warning dialog; discard clears
  assert(page.includes("UnsavedLocalChangesDialog"), "unsaved dialog wired");
  assert(unsavedDlg.includes("متابعة التعديل"), "stay label");
  assert(unsavedDlg.includes("تجاهل"), "discard label");
  assert(page.includes("exit-edit"), "exit-edit pending action");

  // 23. study-system switch clears pending via guard action
  assert(page.includes("set-study-system"), "study system switch guarded");
  assert(
    page.includes("clearLocalEditState") || page.includes("setPending(null)"),
    "pending cleared on context change",
  );

  // 24. no generic Save-all button; RPC save is explicit «حفظ التغيير»
  assert(!editSheet.includes("حفظ التغييرات"), "no save-all button in edit sheet");
  assert(editSheet.includes("حفظ التغيير"), "explicit single-session save button");
  assert(!page.includes("حفظ التغييرات"), "no save-all on page");

  // 25–27. no DB writes / scheduler / publish actions in phase files
  assert(
    !/\bpublish\s*\(/.test(page) && !page.includes("publishVersion") && !page.includes("doPublish"),
    "no publish action on page",
  );
  assert(!editSheet.toLowerCase().includes("نشر"), "no publish copy in edit sheet");
  assert(!queries.includes("run_auto_schedule"), "queries no scheduler");

  // rooms college-scoped active only
  assert(queries.includes("fetchWorkspaceRooms"), "rooms fetch exists");
  assert(queries.includes('.eq("college_id", collegeId)'), "rooms college scoped");
  assert(queries.includes('.eq("is_active", true)'), "rooms active only");
  assert(page.includes("fetchWorkspaceRooms"), "page loads rooms once (not per session)");

  // 28. incomplete data does not break helpers
  const incomplete = sampleSession({
    id: "sess-2",
    room_id: null,
    instructor_name: "—",
    updated_at: null,
  });
  const form2 = formValuesFromSession(incomplete);
  assert(form2.room_id === "", "null room → empty form room");
  const pendingNull = buildPendingChange({
    session: incomplete,
    proposed: { ...snapshotOriginalFromSession(incomplete), day_of_week: 1 },
    changeReason: "",
  });
  assert(pendingNull.expectedUpdatedAt === null, "null updated_at preserved");
  const rows = buildBeforeAfterRows(
    pendingNull,
    (d) => String(d),
    (id) => (id ? id : "—"),
  );
  assert(
    rows.some((r) => r.field === "اليوم"),
    "before/after includes day",
  );

  // 29–30. college + study-system scope preserved in queries
  assert(queries.includes('.eq("college_id", params.collegeId)'), "sessions college scoped");
  assert(queries.includes("applyStudySystemFilter"), "study system filter kept");
  assert(queries.includes("updated_at, is_locked"), "concurrency fields selected");

  // Locked session cannot open for local edit
  assert(
    canOpenSessionForLocalEdit({
      editModeActive: true,
      canEnterEdit: true,
      session: { is_locked: true },
    }) === false,
    "locked session blocked",
  );

  // Copy guards
  assert(SCHEDULE_BUILDER_LOCAL_ONLY_NOTICE_AR.includes("محلي"), "local-only notice constant");
  assert(
    SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR.includes("قاعدة البيانات"),
    "no-db-save notice constant",
  );
  assert(
    editSheet.includes("افحص التعارضات قبل الحفظ") || editSheet.includes("فحص التعارضات"),
    "conflict/save notice in sheet",
  );

  // No localStorage
  assert(!page.includes("localStorage"), "no localStorage on page");
  assert(!pendingSrc.includes("localStorage"), "no localStorage in pending helpers");

  // No migration created this phase
  const migrationsDir = join(root, "supabase", "migrations");
  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir);
    assert(
      !files.some((f) => f.toLowerCase().includes("schedule-builder-edit-local")),
      "no phase migration file",
    );
  }

  // Single pending session model: changing session replaces pending (page keeps one pending)
  const other = sampleSession({ id: "sess-other", day_of_week: 1 });
  let current: PendingScheduleSessionChange | null = pendingDay;
  const next = buildPendingChange({
    session: other,
    proposed: { ...snapshotOriginalFromSession(other), day_of_week: 2 },
    changeReason: "",
  });
  current = next;
  assert(current.sessionId === "sess-other", "single pending session at a time");
  assert(hasPendingChanges(current), "replacement pending is dirty");

  console.log("schedule-builder-edit-local-state-ui harness: PASS");
}

function allSessionsUnchangedConcept(
  original: WorkspaceSessionView,
  pending: PendingScheduleSessionChange,
): boolean {
  // Original object fields remain; pending holds proposed separately.
  return (
    original.day_of_week === pending.original.day_of_week ||
    normalizeTimeHHMM(original.start_time) === normalizeTimeHHMM(pending.original.start_time)
  );
}

run();
