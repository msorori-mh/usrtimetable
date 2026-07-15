/**
 * PHASE-6-ENROLLMENT-OWNERSHIP-AND-SPLIT-PROPOSAL-UI-01 harness.
 * No DB writes. Proposal-only; live inventory arrays (never hardcoded 14/4/60/30 in product).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIRMED_ENROLLMENT_BADGE_AR,
  ENROLLMENT_STATUS_LABEL_AR,
  ENROLLMENT_TRUST_WARNING_AR,
  TEST_ENROLLMENT_BADGE_AR,
  UNVERIFIED_ENROLLMENT_BADGE_AR,
  capacityFitForConfirmed,
  evaluateCapacityAgainstRoom,
  normalizeEnrollmentCountStatus,
} from "../../src/lib/schedule-builder/enrollment-trust";
import {
  canEditEnrollmentOwnership,
  validateEnrollmentOwnershipDraft,
} from "../../src/lib/schedule-builder/enrollment-ownership";
import {
  buildSplitProposalForUi,
  shouldOfferSplitProposal,
  resolveBestEligibleRoomCapacity,
} from "../../src/lib/schedule-builder/split-proposal-ui";
import {
  distributeStudentsBalanced,
  proposeCapacitySplit,
} from "../../src/lib/schedule-builder/section-subgroups";
import {
  filterRoomsByEligibility,
  preferredRoomTypesForSessionType,
  sessionTypeRequiredRoomTypeConflict,
} from "../../src/lib/schedule-builder/room-type-policy";
import { conflictMessageAr } from "../../src/lib/schedule-builder/conflict-code-messages";
import {
  applyPendingToSessions,
  buildPendingChange,
  hasPendingChanges,
} from "../../src/lib/schedule-builder/pending-change";
import type { WorkspaceSessionView } from "../../src/lib/schedule-builder/workspace";
import { canEnterEditMode } from "../../src/lib/schedule-builder/edit-access";

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
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "lecture",
    study_system: "regular",
    course_code: "CS101",
    course_name: "مقدمة",
    instructor_name: "د. أحمد",
    room_label: "Q1",
    section_number: "1",
    subgroup_code: null,
    subgroup_expected_students: null,
    enrollment_count_status: "unverified",
    enrollment_count: 40,
    enrollment_count_updated_at: null,
    course_offering_id: "off-1",
    program_name: "IT",
    level_name: "1",
    department_name: "CS",
    instructor_id: "i1",
    section_id: "s1",
    section_subgroup_id: null,
    room_id: "r1",
    program_id: "p1",
    level_id: "l1",
    updated_at: "2026-07-01T12:00:00.000Z",
    is_locked: false,
    ...partial,
  };
}

function liveInventoryFixture() {
  const halls = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i + 1}`,
    code: `H${i + 1}`,
    room_type: "lecture_hall",
    capacity: 60,
    is_active: true,
  }));
  const labs = Array.from({ length: 4 }, (_, i) => ({
    id: `l${i + 1}`,
    code: `L${i + 1}`,
    room_type: "computer_lab",
    capacity: 30,
    is_active: true,
  }));
  return [...halls, ...labs];
}

function run() {
  const ownershipSrc = readSrc("src/lib/schedule-builder/enrollment-ownership.ts");
  const splitUiSrc = readSrc("src/lib/schedule-builder/split-proposal-ui.ts");
  const trustSrc = readSrc("src/lib/schedule-builder/enrollment-trust.ts");
  const detailsSheet = readSrc("src/components/schedule-builder/session-details-sheet.tsx");
  const editDlg = readSrc("src/components/schedule-builder/enrollment-edit-dialog.tsx");
  const splitDlg = readSrc("src/components/schedule-builder/split-proposal-dialog.tsx");
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  const subgroupsSrc = readSrc("src/lib/schedule-builder/section-subgroups.ts");

  // 1. confirmed displays as confirmed
  assert(ENROLLMENT_STATUS_LABEL_AR.confirmed === "مؤكد", "confirmed label");
  assert(CONFIRMED_ENROLLMENT_BADGE_AR.includes("مؤكد"), "confirmed badge");
  assert(normalizeEnrollmentCountStatus("confirmed") === "confirmed", "normalize confirmed");

  // 2. estimated warning only (soft)
  const est = evaluateCapacityAgainstRoom({
    enrollmentCount: 200,
    enrollmentStatus: "estimated",
    roomCapacity: 60,
  });
  assert(est.outcome === "soft_warning", "estimated soft only");
  assert(ENROLLMENT_TRUST_WARNING_AR.estimated.includes("تقديري"), "estimated warning ar");

  // 3. unverified warning
  assert(ENROLLMENT_TRUST_WARNING_AR.unverified.includes("غير معتمد"), "unverified warning");
  assert(UNVERIFIED_ENROLLMENT_BADGE_AR.includes("غير معتمد"), "unverified badge");

  // 4. test warning
  assert(ENROLLMENT_TRUST_WARNING_AR.test.includes("تجريبية"), "test warning");
  assert(TEST_ENROLLMENT_BADGE_AR.includes("تجريبية"), "test badge");

  // 5. read_only no edit
  assert(canEditEnrollmentOwnership(false) === false, "read_only cannot edit");
  assert(detailsSheet.includes("canEditEnrollment"), "details gates edit button");
  assert(detailsSheet.includes("تعديل عدد الطلاب"), "edit button label present");
  assert(detailsSheet.includes("{canEditEnrollment && editTarget ?"), "edit button conditional");

  // 6. college_admin other college blocked by narrow update eq college_id
  assert(ownershipSrc.includes('.eq("college_id", params.collegeId)'), "college scope on update");
  assert(ownershipSrc.includes('.eq("id", params.courseOfferingId)'), "offering id scope");
  assert(
    ownershipSrc.includes("expected_students") &&
      ownershipSrc.includes("enrollment_count_status") &&
      ownershipSrc.includes("enrollment_count_updated_at"),
    "narrow three-field update",
  );
  assert(!ownershipSrc.includes("sections_count"), "does not patch unrelated fields");

  // 7. negative rejected
  const neg = validateEnrollmentOwnershipDraft({
    enrollmentCount: -1,
    enrollmentCountStatus: "estimated",
  });
  assert(!neg.ok, "negative rejected");

  // 8. confirmed without valid count rejected
  const badConf = validateEnrollmentOwnershipDraft({
    enrollmentCount: null,
    enrollmentCountStatus: "confirmed",
  });
  assert(!badConf.ok, "confirmed null rejected");
  const badFloat = validateEnrollmentOwnershipDraft({
    enrollmentCount: 12.5,
    enrollmentCountStatus: "confirmed",
  });
  assert(!badFloat.ok, "confirmed float rejected");

  // 9. confirmed within capacity — no split
  assert(
    shouldOfferSplitProposal({
      enrollmentCount: 55,
      enrollmentStatus: "confirmed",
      bestEligibleCapacity: 60,
      selectedRoomCapacity: 60,
    }) === false,
    "within capacity no split",
  );
  assert(
    proposeCapacitySplit({
      enrollmentCount: 55,
      enrollmentStatus: "confirmed",
      roomCapacity: 60,
    }) === null,
    "propose null within capacity",
  );

  // 10. confirmed within +5 — exception label, no split offer
  const fitEx = capacityFitForConfirmed({ enrollmentCount: 64, roomCapacity: 60 });
  assert(fitEx.kind === "within_exception", "within +5 exception");
  assert(
    shouldOfferSplitProposal({
      enrollmentCount: 64,
      enrollmentStatus: "confirmed",
      bestEligibleCapacity: 60,
      selectedRoomCapacity: 60,
    }) === false,
    "within +5 no split button",
  );

  // 11. confirmed over +5 — split proposal
  assert(
    shouldOfferSplitProposal({
      enrollmentCount: 200,
      enrollmentStatus: "confirmed",
      bestEligibleCapacity: 60,
      selectedRoomCapacity: 60,
    }) === true,
    "over +5 offers split",
  );
  const prop = proposeCapacitySplit({
    enrollmentCount: 200,
    enrollmentStatus: "confirmed",
    roomCapacity: 60,
  });
  assert(prop != null && prop.minimumGroups >= 2, "split groups >= 2");
  assert(prop!.autoCreateForbidden === true, "autoCreateForbidden");

  // 12. balanced 2/3/4 groups
  for (const g of [2, 3, 4]) {
    const sizes = distributeStudentsBalanced(100, g);
    assert(sizes.length === g, `groups ${g}`);
    assert(sizes.reduce((a, b) => a + b, 0) === 100, `sum ${g}`);
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1, `balanced ${g}`);
  }

  // 13–15. dialog does not create sessions; subgroup create only via gated RPC path
  assert(
    splitDlg.includes("لا يُنشئ جلسات") || splitDlg.includes("لن تُنشأ جلسات"),
    "split dialog no session create claim",
  );
  assert(splitDlg.includes("اعتماد الاقتراح"), "approve button present");
  // Explicit approve is gated by canApprove + confirmation; creation only via RPC when applied.
  assert(splitDlg.includes("canApprove"), "approve permission gated");
  assert(splitDlg.includes("تأكيد اعتماد التقسيم"), "explicit confirmation");
  assert(splitUiSrc.includes("proposeCapacitySplit"), "uses proposal helper");
  assert(!splitUiSrc.includes(".insert("), "split-ui no insert");
  assert(!splitDlg.includes(".from("), "split dialog no direct table write");
  assert(!detailsSheet.includes(".insert("), "details no insert");
  assert(
    subgroupsSrc.includes("autoCreateForbidden: true"),
    "proposal math still forbids auto create",
  );

  // 16. live inventory dynamic
  const rooms = liveInventoryFixture();
  const best = resolveBestEligibleRoomCapacity({
    rooms,
    sessionType: "lecture",
  });
  assert(best.bestCapacity === 60, "best from fixture capacity");
  assert(best.eligibleCount === 14, "eligible halls from fixture length");
  assert(!splitUiSrc.includes("capacity: 60"), "no hardcoded 60 in split-ui");
  assert(!splitUiSrc.includes("length: 14"), "no hardcoded 14");
  assert(!detailsSheet.includes("capacity: 60"), "no hardcoded capacity in details");

  // 17. theory does not use lab
  const lectureEligible = filterRoomsByEligibility(rooms, { sessionType: "lecture" });
  assert(
    lectureEligible.every((r) => r.room_type === "lecture_hall"),
    "lecture → lecture_hall only",
  );
  assert(preferredRoomTypesForSessionType("lecture").includes("lecture_hall"), "lecture preferred");

  // 18. practical does not use lecture hall
  const labEligible = filterRoomsByEligibility(rooms, { sessionType: "practical" });
  assert(
    labEligible.every((r) => r.room_type === "computer_lab"),
    "practical → lab only",
  );

  // 19. Arabic conflict/warning mapping
  const arCap = conflictMessageAr("room_capacity", {
    capacity: 60,
    expected_students: 200,
  });
  assert(arCap.includes("سعة") || arCap.includes("القاعة"), "capacity ar mapping");
  assert(trustSrc.includes("ENROLLMENT_TRUST_WARNING_AR"), "central trust warnings");

  // 20. local session edits preserved when enrollment dialog opens (independent state)
  const sess = sampleSession({ id: "s1", room_id: "r1" });
  const roomsOpt = [
    { id: "r1", code: "R1", name: "قاعة", room_type: "lecture_hall", capacity: 60 },
  ];
  const pending = buildPendingChange({
    session: sess,
    proposed: {
      day_of_week: 1,
      start_time: "10:00",
      end_time: "12:00",
      room_id: "r1",
    },
    changeReason: "local test",
  });
  assert(hasPendingChanges(pending), "pending exists");
  const applied = applyPendingToSessions([sess], pending, roomsOpt);
  assert(applied[0]!.day_of_week === 1, "pending day kept");
  assert(editDlg.includes("لا يؤثر على تعديلات الجلسة"), "enrollment dialog independence note");
  assert(page.includes("onEnrollmentSaved"), "page handles enrollment save");
  assert(page.includes("enrollmentOverlay"), "enrollment overlay independent of pending");
  assert(!page.includes("queryClient.setQueryData"), "no query cache mutation for enrollment");
  assert(page.includes("setPending"), "page still owns pending");

  // 21. published/archived/locked gates not weakened
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "published",
    }) === false,
    "published still locked",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "archived",
    }) === false,
    "archived still locked",
  );

  // 22. PGRST200 not reintroduced — workspace still uses flat select + client hydrate
  const queries = readSrc("src/lib/schedule-builder/queries.ts");
  assert(!queries.includes("course_offerings("), "no nested offering embed (PGRST200 risk)");
  assert(queries.includes("hydrateWorkspaceSessions"), "client hydrate path");

  // UI save contract: explicit save, confirm for confirmed
  assert(editDlg.includes("حفظ واعتماد"), "explicit save");
  assert(editDlg.includes("تأكيد اعتماد العدد") || editDlg.includes("confirmed"), "confirm path");
  assert(editDlg.includes("إلغاء"), "cancel");

  // DQ warning lecture vs lab required
  const dq = sessionTypeRequiredRoomTypeConflict({
    sessionType: "lecture",
    requiredRoomType: "computer_lab",
  });
  assert(dq.conflict === true, "session/required type conflict");

  const uiBuilt = buildSplitProposalForUi({
    enrollmentCount: 200,
    enrollmentStatus: "confirmed",
    sessionType: "lecture",
    rooms,
    selectedRoomCapacity: 60,
  });
  assert(uiBuilt.proposal != null, "ui proposal built");
  assert(uiBuilt.eligibleCount === 14, "dynamic inventory count");

  // estimated/unverified/test never offer split
  for (const st of ["estimated", "unverified", "test"] as const) {
    assert(
      shouldOfferSplitProposal({
        enrollmentCount: 500,
        enrollmentStatus: st,
        bestEligibleCapacity: 60,
      }) === false,
      `${st} never split offer`,
    );
  }

  // No migration apply artifacts required for this UI phase
  assert(
    existsSync(join(root, "src/lib/schedule-builder/enrollment-ownership.ts")),
    "ownership lib",
  );
  assert(
    existsSync(join(root, "src/components/schedule-builder/enrollment-edit-dialog.tsx")),
    "edit dlg",
  );

  console.log("enrollment-ownership-split-proposal-ui.harness.ts: PASS");
}

run();
