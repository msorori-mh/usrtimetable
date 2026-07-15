/**
 * PHASE-6-EXPLICIT-SPLIT-APPROVAL-CONTRACT-AND-UI-01
 * Source-only RPC + UI contract. No DB apply / no runtime writes in harness.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPLIT_APPROVAL_RPC,
  SPLIT_APPROVAL_SOURCE_POLICY,
  SPLIT_APPROVED_AWAITING_SCHEDULE_AR,
  validateSplitApprovalDraft,
} from "../../src/lib/schedule-builder/split-approval";
import {
  planSubgroups,
  proposeCapacitySplit,
} from "../../src/lib/schedule-builder/section-subgroups";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  const migRel = "supabase/migrations/20260715120000_approve_capacity_split_proposal.sql";
  assert(existsSync(join(root, migRel)), "source migration present");
  const mig = readSrc(migRel);
  const ownership = readSrc("src/lib/schedule-builder/split-approval.ts");
  const dialog = readSrc("src/components/schedule-builder/split-proposal-dialog.tsx");
  const details = readSrc("src/components/schedule-builder/session-details-sheet.tsx");
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");

  // Scope: subgroups only
  assert(mig.includes("INSERT INTO public.section_subgroups"), "inserts subgroups");
  assert(!/INSERT\s+INTO\s+public\.schedule_sessions/i.test(mig), "no session insert");
  assert(!/UPDATE\s+public\.schedule_sessions/i.test(mig), "no session update");
  assert(mig.includes("sessions_created', false"), "sessions_created false");
  assert(mig.includes("source_session_modified', false"), "source session not modified");
  assert(mig.includes("SECURITY DEFINER"), "security definer");
  assert(mig.includes("SET search_path = public"), "safe search_path");
  assert(mig.includes("auth.uid()"), "auth check");
  assert(mig.includes("can_manage_college"), "college manage check");
  assert(mig.includes("REVOKE ALL"), "revoke public/anon");
  assert(mig.includes("GRANT EXECUTE"), "grant execute");
  assert(mig.includes("pg_advisory_xact_lock"), "concurrency lock");
  assert(mig.includes("STALE_ENROLLMENT") || mig.includes("enrollment_count_updated_at"), "stale");
  assert(mig.includes("ALREADY_APPROVED"), "idempotency");
  assert(mig.includes("INSERT INTO public.audit_logs"), "audit");
  assert(mig.includes("enrollment_count_status IS DISTINCT FROM 'confirmed'"), "confirmed only");
  assert(mig.includes("capacity_split_owner_approved"), "source policy");
  assert(!mig.includes("day_of_week ="), "does not change time");
  assert(!mig.includes("instructor_id ="), "does not change instructor");
  assert(
    !mig.includes("room_id = p_room_id") || mig.includes("FROM public.rooms"),
    "room verify only",
  );

  // Client contract
  assert(ownership.includes(SPLIT_APPROVAL_RPC), "rpc name");
  assert(ownership.includes(SPLIT_APPROVED_AWAITING_SCHEDULE_AR), "awaiting schedule status");
  assert(ownership.includes(SPLIT_APPROVAL_SOURCE_POLICY), "source policy const");
  assert(ownership.includes("RPC_NOT_APPLIED"), "handles unapplied migration");
  assert(!ownership.includes('.from("section_subgroups").insert'), "no direct client insert");
  assert(!ownership.includes(".from('section_subgroups').insert"), "no direct client insert sq");

  // Validation
  const badStatus = validateSplitApprovalDraft({
    enrollmentCount: 200,
    enrollmentStatus: "estimated",
    enrollmentCountUpdatedAt: "2026-07-01T00:00:00.000Z",
    roomId: "r1",
    roomCapacity: 60,
  });
  assert(!badStatus.ok, "estimated cannot approve");

  const ok = validateSplitApprovalDraft({
    enrollmentCount: 200,
    enrollmentStatus: "confirmed",
    enrollmentCountUpdatedAt: "2026-07-01T00:00:00.000Z",
    roomId: "r1",
    roomCapacity: 60,
  });
  assert(ok.ok, "confirmed over capacity validates");
  if (ok.ok) {
    const prop = proposeCapacitySplit({
      enrollmentCount: 200,
      enrollmentStatus: "confirmed",
      roomCapacity: 60,
    });
    assert(prop != null, "proposal exists");
    assert(ok.groups.length === prop!.minimumGroups, "groups match formula");
    assert(ok.groups.reduce((a, g) => a + g.expected_students, 0) === 200, "sum matches");
  }

  const within = validateSplitApprovalDraft({
    enrollmentCount: 60,
    enrollmentStatus: "confirmed",
    enrollmentCountUpdatedAt: "2026-07-01T00:00:00.000Z",
    roomId: "r1",
    roomCapacity: 60,
  });
  assert(!within.ok, "within capacity not approvable");

  // UI enabled with confirmation
  assert(dialog.includes("اعتماد الاقتراح"), "approve button");
  assert(dialog.includes("تأكيد اعتماد التقسيم"), "confirm dialog");
  assert(dialog.includes("canApprove"), "permission gate");
  assert(dialog.includes("approveCapacitySplitProposal"), "calls client approve");
  assert(
    dialog.includes(SPLIT_APPROVED_AWAITING_SCHEDULE_AR) || dialog.includes("معتمدة"),
    "status text",
  );
  assert(
    !dialog.includes('disabled\n            title="سيتم تفعيل الاعتماد'),
    "no longer permanently disabled",
  );
  assert(details.includes("canApprove={canEditEnrollment}"), "read_only cannot approve");
  assert(page.includes("onSplitApproved"), "page wired");
  assert(page.includes("setPending"), "pending still owned by page");

  // Balanced plan helper still used
  const plan = planSubgroups(100, 3);
  assert(
    Math.max(...plan.map((p) => p.expected_students)) -
      Math.min(...plan.map((p) => p.expected_students)) <=
      1,
  );

  // No hardcoded inventory in product approve path
  assert(!ownership.includes("capacity: 60"), "no hardcoded capacity");
  assert(!ownership.includes("14"), "no hardcoded hall count");

  console.log("explicit-split-approval-contract-ui.harness.ts: PASS");
}

run();
