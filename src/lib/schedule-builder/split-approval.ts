/**
 * Explicit capacity-split approval client contract.
 * RPC creates section_subgroups only — never schedule_sessions.
 * Runtime write requires applied migration; UI must not invent DB rows locally.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  CAPACITY_EXCEPTION_LIMIT,
  MAX_SUBGROUPS,
  planSubgroups,
  proposeCapacitySplit,
  type SubgroupPlanRow,
} from "@/lib/schedule-builder/section-subgroups";
import {
  isHardCapacityStatus,
  normalizeEnrollmentCountStatus,
  type EnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";

export const SPLIT_APPROVAL_SOURCE_POLICY = "capacity_split_owner_approved";
export const SPLIT_APPROVED_AWAITING_SCHEDULE_AR = "معتمدة — بانتظار الجدولة";
export const SPLIT_APPROVAL_RPC = "approve_capacity_split_proposal";

export type SplitApprovalContext = {
  collegeId: string;
  courseOfferingId: string;
  sectionId: string;
  sourceSessionId: string;
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus | string | null | undefined;
  enrollmentCountUpdatedAt: string | null;
  roomId: string;
  roomCapacity: number;
  groups: SubgroupPlanRow[];
};

export type SplitApprovalValidation =
  | { ok: true; groups: SubgroupPlanRow[]; roomCapacity: number; enrollmentCount: number }
  | { ok: false; reasonAr: string; code: string };

export function validateSplitApprovalDraft(params: {
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus | string | null | undefined;
  enrollmentCountUpdatedAt: string | null;
  roomId: string | null | undefined;
  roomCapacity: number | null | undefined;
  groups?: SubgroupPlanRow[] | null;
}): SplitApprovalValidation {
  const status = normalizeEnrollmentCountStatus(params.enrollmentStatus);
  if (!isHardCapacityStatus(status)) {
    return {
      ok: false,
      code: "ENROLLMENT_NOT_CONFIRMED",
      reasonAr: "لا يمكن اعتماد التقسيم إلا عندما تكون حالة العدد مؤكدة.",
    };
  }
  if (!Number.isInteger(params.enrollmentCount) || params.enrollmentCount < 0) {
    return {
      ok: false,
      code: "INVALID_COUNT",
      reasonAr: "العدد المؤكد يجب أن يكون عددًا صحيحًا غير سالب.",
    };
  }
  if (!params.enrollmentCountUpdatedAt) {
    return {
      ok: false,
      code: "MISSING_ENROLLMENT_UPDATED_AT",
      reasonAr: "وقت آخر تحديث للعدد مطلوب لحماية التزامن.",
    };
  }
  if (!params.roomId) {
    return {
      ok: false,
      code: "ROOM_REQUIRED",
      reasonAr: "يجب تحديد قاعة لحساب سعة الاعتماد.",
    };
  }
  const roomCapacity = params.roomCapacity;
  if (roomCapacity == null || !Number.isInteger(roomCapacity) || roomCapacity <= 0) {
    return {
      ok: false,
      code: "INVALID_ROOM_CAPACITY",
      reasonAr: "سعة القاعة غير صالحة.",
    };
  }

  const proposal = proposeCapacitySplit({
    enrollmentCount: params.enrollmentCount,
    enrollmentStatus: status,
    roomCapacity,
  });
  if (!proposal) {
    return {
      ok: false,
      code: "SPLIT_NOT_REQUIRED",
      reasonAr: "العدد المؤكد لا يتجاوز السعة مع استثناء +5؛ لا حاجة لتقسيم.",
    };
  }

  const expected = planSubgroups(params.enrollmentCount, proposal.minimumGroups);
  const groups = params.groups?.length ? params.groups : expected;
  if (groups.length !== expected.length) {
    return {
      ok: false,
      code: "GROUPS_COUNT_MISMATCH",
      reasonAr: "عدد المجموعات لا يطابق معادلة التقسيم المعتمدة.",
    };
  }
  for (let i = 0; i < expected.length; i++) {
    const a = groups[i]!;
    const b = expected[i]!;
    if (
      a.ordinal !== b.ordinal ||
      a.subgroup_code !== b.subgroup_code ||
      a.expected_students !== b.expected_students
    ) {
      return {
        ok: false,
        code: "GROUPS_DISTRIBUTION_MISMATCH",
        reasonAr: "توزيع المجموعات لا يطابق الاقتراح المعتمد.",
      };
    }
  }
  if (groups.length > MAX_SUBGROUPS || groups.length < 2) {
    return {
      ok: false,
      code: "GROUPS_COUNT_MISMATCH",
      reasonAr: "عدد المجموعات خارج النطاق المسموح (2–4).",
    };
  }

  return {
    ok: true,
    groups,
    roomCapacity,
    enrollmentCount: params.enrollmentCount,
  };
}

export type ApproveCapacitySplitResult =
  | {
      ok: true;
      code: "APPROVED" | "ALREADY_APPROVED";
      statusAr: string;
      createdSubgroupIds: string[];
      sessionsCreated: false;
      sourceSessionModified: false;
      rpcApplied: true;
    }
  | {
      ok: false;
      code: string;
      reasonAr: string;
      stale?: boolean;
      /** false when migration/RPC is not applied on the linked project */
      rpcApplied: boolean;
    };

function mapRpcError(
  error: { message?: string; code?: string } | null,
): ApproveCapacitySplitResult {
  const msg = error?.message ?? "";
  const code = error?.code ?? "";
  const missing =
    code === "PGRST202" ||
    /could not find the function/i.test(msg) ||
    /approve_capacity_split_proposal/i.test(msg);
  if (missing) {
    return {
      ok: false,
      code: "RPC_NOT_APPLIED",
      reasonAr:
        "عقد الاعتماد جاهز في المصدر لكنه غير مُطبَّق على قاعدة البيانات بعد. طبّق Migration ثم أعد المحاولة.",
      rpcApplied: false,
    };
  }
  return {
    ok: false,
    code: code || "RPC_ERROR",
    reasonAr: msg || "تعذّر اعتماد اقتراح التقسيم.",
    rpcApplied: true,
  };
}

/**
 * Calls approve_capacity_split_proposal when available.
 * Does not create local DB rows; does not touch schedule_sessions.
 */
export async function approveCapacitySplitProposal(
  ctx: SplitApprovalContext,
): Promise<ApproveCapacitySplitResult> {
  const validated = validateSplitApprovalDraft({
    enrollmentCount: ctx.enrollmentCount,
    enrollmentStatus: ctx.enrollmentStatus,
    enrollmentCountUpdatedAt: ctx.enrollmentCountUpdatedAt,
    roomId: ctx.roomId,
    roomCapacity: ctx.roomCapacity,
    groups: ctx.groups,
  });
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      reasonAr: validated.reasonAr,
      rpcApplied: true,
    };
  }

  const { data, error } = await supabase.rpc("approve_capacity_split_proposal", {
    p_college_id: ctx.collegeId,
    p_course_offering_id: ctx.courseOfferingId,
    p_section_id: ctx.sectionId,
    p_source_session_id: ctx.sourceSessionId,
    p_expected_students: validated.enrollmentCount,
    p_expected_enrollment_count_updated_at: ctx.enrollmentCountUpdatedAt!,
    p_room_id: ctx.roomId,
    p_room_capacity: validated.roomCapacity,
    p_groups: validated.groups as unknown as Json,
  });

  if (error) return mapRpcError(error);

  const row = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    message_ar?: string;
    status_ar?: string;
    stale?: boolean;
    created_subgroup_ids?: string[];
    sessions_created?: boolean;
    source_session_modified?: boolean;
  };

  if (!row.ok) {
    return {
      ok: false,
      code: row.code ?? "REJECTED",
      reasonAr: row.message_ar ?? "رُفض اعتماد التقسيم.",
      stale: !!row.stale,
      rpcApplied: true,
    };
  }

  if (row.sessions_created === true || row.source_session_modified === true) {
    return {
      ok: false,
      code: "CONTRACT_VIOLATION",
      reasonAr: "استجابة غير متوقعة: يُمنع إنشاء أو تعديل الجلسات في هذه المرحلة.",
      rpcApplied: true,
    };
  }

  const code = row.code === "ALREADY_APPROVED" ? "ALREADY_APPROVED" : "APPROVED";
  return {
    ok: true,
    code,
    statusAr: row.status_ar ?? row.message_ar ?? SPLIT_APPROVED_AWAITING_SCHEDULE_AR,
    createdSubgroupIds: Array.isArray(row.created_subgroup_ids)
      ? row.created_subgroup_ids.map(String)
      : [],
    sessionsCreated: false,
    sourceSessionModified: false,
    rpcApplied: true,
  };
}

export function splitApprovalCapacityPlus(roomCapacity: number): number {
  return roomCapacity + CAPACITY_EXCEPTION_LIMIT;
}
