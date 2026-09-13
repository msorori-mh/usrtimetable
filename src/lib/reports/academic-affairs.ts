import type { TeachingAssignmentWorkspaceRow } from "../academic-delivery/teaching-assignments-v2.ts";
import {
  QUOTA_SOURCE_LABEL_AR,
  QUOTA_STATUS_LABEL_AR,
  QUOTA_UNDEFINED_AR,
  computeQuotaBalance,
  summarizeQuotaBalances,
  type QuotaBalance,
} from "./instructor-quota";

export type AcademicInstructor = {
  id: string;
  full_name: string;
  academic_rank: string | null;
  department_id: string | null;
  /** approved weekly load on the member's own card (`instructors.max_weekly_hours`) */
  max_weekly_hours?: number | null;
  /** administrative release hours (`instructors.administrative_release_hours`) */
  administrative_release_hours?: number | null;
};
export type AcademicProgram = {
  id: string;
  name: string;
  department_id: string | null;
};
export type AcademicWorkload = {
  instructor_id: string;
  required_load_hours: number | null;
  standard_assigned_hours: number;
  project_supervision_hours: number;
};

export type AcademicScope = {
  collegeId: string;
  termId: string;
  departmentId: string;
  programId: string;
  instructorId: string;
};
export type AcademicReportKind = "workload" | "assignments" | "shortages";
export type AcademicReportRow = Record<string, string | number | null>;
export type AcademicReportInput = {
  scope: AcademicScope;
  instructors: AcademicInstructor[];
  programs: AcademicProgram[];
  departments: { id: string; name: string }[];
  groups: TeachingAssignmentWorkspaceRow[];
  workloads: AcademicWorkload[];
};

/** Invalid or failed RPC payloads must never become plausible zero-hour reports. */
export function parseAcademicWorkload(value: unknown, instructorId: string): AcademicWorkload {
  if (!value || typeof value !== "object") throw new Error("تعذر قراءة النصاب المعتمد");
  const row = value as Record<string, unknown>;
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (
    row.instructor_id !== instructorId ||
    !(row.required_load_hours === null || validNumber(row.required_load_hours)) ||
    !validNumber(row.standard_assigned_hours) ||
    !validNumber(row.project_supervision_hours)
  )
    throw new Error("بيانات النصاب غير مكتملة؛ لا يمكن اعتماد التقرير");
  return row as AcademicWorkload;
}

const COMPONENT_LABELS: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  lab: "معمل",
  tutorial: "تمارين",
  project: "مشروع",
  clinical: "سريري",
  field_training: "تدريب ميداني",
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildAcademicReport(
  input: AcademicReportInput,
  kind: AcademicReportKind,
): AcademicReportRow[] {
  const { scope, instructors, programs, departments, workloads } = input;
  const programMap = new Map(programs.map((p) => [p.id, p]));
  const departmentMap = new Map(departments.map((d) => [d.id, d.name]));
  const groups = input.groups.filter(
    (g) =>
      g.college_id === scope.collegeId &&
      g.term_id === scope.termId &&
      g.active &&
      !g.is_obsolete &&
      (scope.departmentId === "all" ||
        programMap.get(g.program_id)?.department_id === scope.departmentId) &&
      (scope.programId === "all" || g.program_id === scope.programId),
  );
  const selectedGroups = groups.filter(
    (g) =>
      scope.instructorId === "all" ||
      g.instructors.some((i) => i.is_active && i.instructor_id === scope.instructorId),
  );
  const groupInfo = (g: TeachingAssignmentWorkspaceRow): AcademicReportRow => ({
    department: departmentMap.get(programMap.get(g.program_id)?.department_id ?? "") ?? "غير محدد",
    program: programMap.get(g.program_id)?.name ?? "غير محدد",
    course: `${g.course_code} — ${g.course_name}`,
    cohort: g.cohort_code ?? "—",
    group: g.group_code,
    component: COMPONENT_LABELS[g.component_type] ?? g.component_type,
    required: g.component_hours,
  });

  if (kind === "assignments")
    return selectedGroups.flatMap((g) => {
      const active = g.instructors.filter((i) => i.is_active);
      return active
        .filter((i) => scope.instructorId === "all" || i.instructor_id === scope.instructorId)
        .map((i) => ({
          ...groupInfo(g),
          instructor: i.instructor_name ?? "غير محدد",
          assigned: i.assigned_component_hours ?? (active.length === 1 ? g.component_hours : null),
          note:
            i.assigned_component_hours === null && active.length > 1
              ? "ساعات التدريس المشترك غير محددة"
              : "",
        }));
    });

  if (kind === "shortages")
    return selectedGroups
      .filter((g) => g.remaining_hours > 0)
      .map((g) => ({
        ...groupInfo(g),
        assigned: round(g.assigned_hours_total),
        shortage: round(g.remaining_hours),
        instructors:
          g.instructors
            .filter((i) => i.is_active)
            .map((i) => i.instructor_name)
            .join("، ") || "لم يُسند",
      }));

  const relatedInstructorIds = new Set(
    groups.flatMap((g) => g.instructors.filter((i) => i.is_active).map((i) => i.instructor_id)),
  );
  const facts = new Map(workloads.map((w) => [w.instructor_id, w]));
  return instructors
    .filter(
      (i) =>
        (scope.instructorId === "all" || i.id === scope.instructorId) &&
        (scope.programId === "all" || relatedInstructorIds.has(i.id)) &&
        (scope.departmentId === "all" ||
          i.department_id === scope.departmentId ||
          relatedInstructorIds.has(i.id)),
    )
    .map((i) => {
      const w = facts.get(i.id);
      if (!w) throw new Error("بيانات أعباء أعضاء هيئة التدريس غير مكتملة");
      // Full college/term load survives program filtering: a partial program load is not a personal deficit.
      const balance = computeQuotaBalance({
        policyRequiredHours: w.required_load_hours,
        maxWeeklyHours: i.max_weekly_hours,
        adminReleaseHours: i.administrative_release_hours,
        assignedHours: w.standard_assigned_hours,
      });
      return {
        instructor: i.full_name,
        department: departmentMap.get(i.department_id ?? "") ?? "غير محدد",
        rank: i.academic_rank ?? "غير محدد",
        base_required: balance.baseHours ?? QUOTA_UNDEFINED_AR,
        release: balance.releaseHours,
        required: balance.netHours ?? QUOTA_UNDEFINED_AR,
        assigned: balance.assignedHours,
        project: round(w.project_supervision_hours),
        overload: balance.overloadHours ?? QUOTA_UNDEFINED_AR,
        deficit: balance.deficitHours ?? QUOTA_UNDEFINED_AR,
        quota_source: QUOTA_SOURCE_LABEL_AR[balance.source],
        status: QUOTA_STATUS_LABEL_AR[balance.status],
      };
    });
}

/** True when the member has no approved quota, so totals and states can exclude the row. */
export function isMissingQuotaRow(row: AcademicReportRow): boolean {
  return row.status === QUOTA_STATUS_LABEL_AR.missing;
}

/** Recomputes truthful totals from workload rows exactly as they are displayed/exported. */
export function summarizeWorkloadRows(rows: AcademicReportRow[]) {
  const balances: QuotaBalance[] = rows.map((row) => ({
    baseHours: typeof row.base_required === "number" ? row.base_required : null,
    releaseHours: typeof row.release === "number" ? row.release : 0,
    netHours: typeof row.required === "number" ? row.required : null,
    source: "instructor",
    assignedHours: typeof row.assigned === "number" ? row.assigned : 0,
    overloadHours: typeof row.overload === "number" ? row.overload : null,
    deficitHours: typeof row.deficit === "number" ? row.deficit : null,
    status: isMissingQuotaRow(row)
      ? "missing"
      : Number(row.overload) > 0
        ? "overload"
        : Number(row.deficit) > 0
          ? "deficit"
          : "balanced",
  }));
  return summarizeQuotaBalances(balances);
}


export const ACADEMIC_REPORT_TITLES: Record<AcademicReportKind, string> = {
  workload: "النصاب والساعات الزائدة والنقص",
  assignments: "تقرير الإسناد التدريسي",
  shortages: "عجز الإسناد التدريسي",
};
export const ACADEMIC_REPORT_HEADERS: Record<AcademicReportKind, { key: string; label: string }[]> =
  {
    workload: [
      { key: "instructor", label: "عضو هيئة التدريس" },
      { key: "department", label: "القسم التابع له" },
      { key: "rank", label: "الرتبة" },
      { key: "base_required", label: "النصاب الأساسي المعتمد" },
      { key: "release", label: "التخفيض الإداري" },
      { key: "required", label: "صافي النصاب المعتمد" },
      { key: "assigned", label: "المسند في الكلية والفصل" },
      { key: "project", label: "إشراف المشاريع" },
      { key: "overload", label: "ساعات زائدة" },
      { key: "deficit", label: "نقص النصاب" },
      { key: "quota_source", label: "مصدر النصاب" },
      { key: "status", label: "الحالة" },
    ],

    assignments: [
      { key: "department", label: "قسم البرنامج" },
      { key: "program", label: "البرنامج" },
      { key: "course", label: "المقرر" },
      { key: "cohort", label: "الدفعة" },
      { key: "group", label: "المجموعة" },
      { key: "component", label: "المحاضرة" },
      { key: "instructor", label: "عضو هيئة التدريس" },
      { key: "required", label: "ساعات المحاضرة" },
      { key: "assigned", label: "ساعات العضو" },
      { key: "note", label: "ملاحظة" },
    ],
    shortages: [
      { key: "department", label: "قسم البرنامج" },
      { key: "program", label: "البرنامج" },
      { key: "course", label: "المقرر" },
      { key: "cohort", label: "الدفعة" },
      { key: "group", label: "المجموعة" },
      { key: "component", label: "المحاضرة" },
      { key: "required", label: "الساعات المطلوبة" },
      { key: "assigned", label: "الساعات المسندة" },
      { key: "shortage", label: "عجز الإسناد" },
      { key: "instructors", label: "أعضاء هيئة التدريس" },
    ],
  };
