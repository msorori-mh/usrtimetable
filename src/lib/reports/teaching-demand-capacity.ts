import type { TeachingAssignmentWorkspaceRow } from "@/lib/academic-delivery/teaching-assignments-v2";
import type { LeadershipCollege } from "./leadership";
import type { LeadershipCapacityCollege } from "./leadership-room-capacity";

export interface DemandCohort {
  id: string;
  college_id: string;
  term_id: string;
  program_id: string;
  level_id: string;
  active: boolean;
}
export interface DemandProgram {
  id: string;
  college_id: string;
  name: string;
}
export interface DemandLevel {
  id: string;
  college_id: string;
  program_id: string;
  name: string;
  level_number: number | null;
}
export interface DemandSharedLink {
  anchor_group_id: string;
  cohort_id: string;
}

export interface ProgramLevelDemand {
  collegeId: string;
  college: string;
  programId: string;
  program: string;
  levelId: string;
  level: string;
  levelNumber: number | null;
  groups: number;
  requiredHours: number;
  theoryHours: number;
  practicalHours: number;
  otherHours: number;
  sharedHours: number;
  cohortsWithoutGroups: number;
}

export interface DemandBreakdown {
  rows: ProgramLevelDemand[];
  /** Each physical teaching group occurs once, including a shared lecture. */
  physicalHoursByCollege: Record<string, number>;
  /** Program/level rows repeat a shared lecture for every participating level. */
  repeatedSharedHoursByCollege: Record<string, number>;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const practicalTypes = new Set(["practical", "lab", "clinical", "field_training"]);

/** Group demand comes from the active teaching workspace, never from instructor allocations. */
export function buildProgramLevelDemand(input: {
  colleges: LeadershipCollege[];
  groups: TeachingAssignmentWorkspaceRow[];
  cohorts: DemandCohort[];
  programs: DemandProgram[];
  levels: DemandLevel[];
  sharedLinks: DemandSharedLink[];
}): DemandBreakdown {
  const colleges = new Map(input.colleges.map((c) => [c.college_id, c]));
  const cohorts = new Map(input.cohorts.map((c) => [c.id, c]));
  const programs = new Map(input.programs.map((p) => [p.id, p]));
  const levels = new Map(input.levels.map((l) => [l.id, l]));
  const sharedByAnchor = new Map<string, Set<string>>();
  for (const link of input.sharedLinks) {
    const ids = sharedByAnchor.get(link.anchor_group_id) ?? new Set<string>();
    ids.add(link.cohort_id);
    sharedByAnchor.set(link.anchor_group_id, ids);
  }
  const byLevel = new Map<string, ProgramLevelDemand>();
  const physicalHoursByCollege: Record<string, number> = {};
  const seenGroups = new Set<string>();
  const reachedCohorts = new Set<string>();
  for (const cohort of input.cohorts) {
    const college = colleges.get(cohort.college_id);
    if (!cohort.active || college?.term_state !== "ready" || cohort.term_id !== college.term_id)
      continue;
    const program = programs.get(cohort.program_id);
    const level = levels.get(cohort.level_id);
    if (
      !program ||
      !level ||
      program.college_id !== college.college_id ||
      level.college_id !== college.college_id ||
      level.program_id !== program.id
    )
      throw new Error("هوية البرنامج أو المستوى غير مكتملة في مصدر التقرير");
    const key = `${college.college_id}:${program.id}:${level.id}`;
    if (!byLevel.has(key))
      byLevel.set(key, {
        collegeId: college.college_id,
        college: college.college,
        programId: program.id,
        program: program.name,
        levelId: level.id,
        level: level.name,
        levelNumber: level.level_number,
        groups: 0,
        requiredHours: 0,
        theoryHours: 0,
        practicalHours: 0,
        otherHours: 0,
        sharedHours: 0,
        cohortsWithoutGroups: 0,
      });
  }
  for (const group of input.groups) {
    if (!group.active || group.is_obsolete) continue;
    const college = colleges.get(group.college_id);
    if (!college || college.term_state !== "ready" || !college.term_id) continue;
    if (group.term_id !== college.term_id || !group.delivery_group_id) {
      throw new Error("مجموعة تدريس خارج الفصل المحدد؛ تعذر اعتماد تفصيل الساعات");
    }
    if (seenGroups.has(group.delivery_group_id)) {
      throw new Error("تكررت مجموعة تدريس في مصدر التقرير");
    }
    seenGroups.add(group.delivery_group_id);
    const h = group.component_hours;
    if (typeof h !== "number" || !Number.isFinite(h) || h < 0) {
      throw new Error("ساعات إحدى مجموعات التدريس غير مكتملة");
    }
    physicalHoursByCollege[college.college_id] = round2(
      (physicalHoursByCollege[college.college_id] ?? 0) + h,
    );
    const cohortIds = new Set([
      group.cohort_id,
      ...(sharedByAnchor.get(group.delivery_group_id) ?? []),
    ]);
    const destinations = new Set<string>();
    for (const cohortId of cohortIds) {
      const cohort = cohorts.get(cohortId);
      if (
        !cohort ||
        !cohort.active ||
        cohort.college_id !== college.college_id ||
        cohort.term_id !== college.term_id
      ) {
        throw new Error("رابط محاضرة مشتركة أو دفعة غير صالح لتقرير البرنامج والمستوى");
      }
      const program = programs.get(cohort.program_id);
      const level = levels.get(cohort.level_id);
      if (
        !program ||
        !level ||
        program.college_id !== college.college_id ||
        level.college_id !== college.college_id ||
        level.program_id !== program.id
      ) {
        throw new Error("هوية البرنامج أو المستوى غير مكتملة في مصدر التقرير");
      }
      // A shared lecture inside one program/level needs one row contribution.
      const key = `${college.college_id}:${program.id}:${level.id}`;
      reachedCohorts.add(cohort.id);
      if (destinations.has(key)) continue;
      destinations.add(key);
      const row = byLevel.get(key) ?? {
        collegeId: college.college_id,
        college: college.college,
        programId: program.id,
        program: program.name,
        levelId: level.id,
        level: level.name,
        levelNumber: level.level_number,
        groups: 0,
        requiredHours: 0,
        theoryHours: 0,
        practicalHours: 0,
        otherHours: 0,
        sharedHours: 0,
        cohortsWithoutGroups: 0,
      };
      row.groups += 1;
      row.requiredHours = round2(row.requiredHours + h);
      if (group.component_type === "theory") row.theoryHours = round2(row.theoryHours + h);
      else if (practicalTypes.has(group.component_type))
        row.practicalHours = round2(row.practicalHours + h);
      else row.otherHours = round2(row.otherHours + h);
      if (cohortIds.size > 1) row.sharedHours = round2(row.sharedHours + h);
      byLevel.set(key, row);
    }
  }
  for (const cohort of input.cohorts) {
    if (
      !cohort.active ||
      reachedCohorts.has(cohort.id) ||
      cohort.term_id !== colleges.get(cohort.college_id)?.term_id
    )
      continue;
    const key = `${cohort.college_id}:${cohort.program_id}:${cohort.level_id}`;
    const row = byLevel.get(key);
    if (row) row.cohortsWithoutGroups += 1;
  }
  for (const college of input.colleges.filter((c) => c.term_state === "ready")) {
    const expected = college.required_hours;
    if (
      expected === null ||
      !Number.isFinite(expected) ||
      Math.abs((physicalHoursByCollege[college.college_id] ?? 0) - expected) > 0.01
    ) {
      throw new Error(`الساعات المفصلة لا تطابق إجمالي ${college.college}؛ أعد تحميل التقرير`);
    }
  }
  const rows = [...byLevel.values()].sort(
    (a, b) =>
      a.college.localeCompare(b.college, "ar") ||
      a.program.localeCompare(b.program, "ar") ||
      (a.levelNumber ?? 999) - (b.levelNumber ?? 999) ||
      a.level.localeCompare(b.level, "ar"),
  );
  const repeatedSharedHoursByCollege: Record<string, number> = {};
  for (const college of input.colleges) {
    repeatedSharedHoursByCollege[college.college_id] = round2(
      rows
        .filter((r) => r.collegeId === college.college_id)
        .reduce((n, r) => n + r.requiredHours, 0) -
        (physicalHoursByCollege[college.college_id] ?? 0),
    );
  }
  return { rows, physicalHoursByCollege, repeatedSharedHoursByCollege };
}

export interface CollegeDemandCapacity {
  collegeId: string;
  college: string;
  requiredHours: number | null;
  availableHours: number | null;
  balanceHours: number | null;
  rooms: number | null;
  published: boolean;
  status: "calculable" | "partial" | "unavailable";
  issues: string[];
}

export function capacityAssessment(row: CollegeDemandCapacity): string {
  if (row.balanceHours === null) return "البيانات غير كافية للمقارنة";
  if (row.balanceHours < 0) return `عجز إجمالي ${Math.abs(row.balanceHours)} ساعة`;
  if (row.balanceHours > 0) return `فرق موجب ${row.balanceHours} ساعة؛ يلزم فحص النوع والموعد`;
  return "متوازن حسابيًا؛ يلزم فحص التوقيت";
}

export function summarizeDemandCapacity(
  colleges: LeadershipCollege[],
  capacity: LeadershipCapacityCollege[],
): CollegeDemandCapacity[] {
  const byId = new Map(capacity.map((row) => [row.id, row]));
  return colleges.map((college) => {
    const c = byId.get(college.college_id);
    const issues = [...(c?.issues ?? [])];
    if (!college.version_id) issues.push("لا توجد نسخة منشورة؛ اكتمال المحاضرات يحتاج مراجعة");
    if (college.term_state !== "ready") issues.push("الفصل الأكاديمي غير محسوم");
    if (!college.groups_count) issues.push("مجموعات التدريس غير مكتملة أو غير مدخلة");
    if (!c) issues.push("تعذر قراءة إتاحة القاعات");
    return {
      collegeId: college.college_id,
      college: college.college,
      requiredHours: college.term_state === "ready" ? college.required_hours : null,
      availableHours: c?.availableHours ?? null,
      balanceHours: c?.balanceHours ?? null,
      rooms: c ? c.rooms.length : null,
      published: !!college.version_id,
      status:
        !c || c.availableHours === null || college.required_hours === null
          ? "unavailable"
          : issues.length > 0
            ? "partial"
            : "calculable",
      issues,
    };
  });
}

/** Never represent a partial university sum as a complete surplus. */
export function summarizeUniversityCapacity(rows: CollegeDemandCapacity[]) {
  const complete = rows.length > 0 && rows.every((r) => r.status === "calculable");
  const sum = (key: "requiredHours" | "availableHours" | "balanceHours") =>
    complete ? round2(rows.reduce((n, r) => n + r[key]!, 0)) : null;
  return {
    colleges: rows.length,
    calculable: rows.filter((r) => r.status === "calculable").length,
    requiredHours: sum("requiredHours"),
    availableHours: sum("availableHours"),
    balanceHours: sum("balanceHours"),
    complete,
  };
}
