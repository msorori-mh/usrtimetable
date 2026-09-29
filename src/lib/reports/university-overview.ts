import {
  physicalRoomGroups,
  physicalRoomKey,
  physicalSeatCount,
  physicalRoomSourcesComplete,
} from "./physical-rooms";
import type { LeadershipCollege } from "./leadership";
import type { LeadershipDetailRow } from "./leadership-metrics";
import type { CapacitySources } from "./leadership-room-capacity";
import { minutes, roomUtilizationMetrics } from "./presentation-metrics";
import { roomCategoryFromType } from "@/lib/room-category";

export type OverviewSourceMode = "presentation" | "published";
export interface OverviewVersion {
  id: string;
  college_id: string;
  academic_term_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  disposable_test: boolean;
}
export interface OverviewSession {
  id: string;
  college_id: string;
  schedule_version_id: string;
  delivery_group_id: string | null;
  cohort_id: string | null;
  instructor_id: string | null;
  room_id: string | null;
  session_type: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  replaced_by_split: boolean | null;
}
export interface OverviewDepartment {
  id: string;
  college_id: string;
  name: string;
  is_archived: boolean;
}
export interface OverviewProgram {
  id: string;
  college_id: string;
  department_id: string;
  name: string;
  is_archived: boolean;
}
export interface OverviewCohort {
  id: string;
  college_id: string;
  term_id: string;
  program_id: string;
}
export interface OverviewGroup {
  id: string;
  college_id: string;
  cohort_id: string | null;
}
export interface UniversityOverviewSources extends Omit<CapacitySources, "sessions"> {
  colleges: LeadershipCollege[];
  collegeCodes: Array<{ id: string; code: string | null }>;
  departments: OverviewDepartment[];
  programs: OverviewProgram[];
  cohorts: OverviewCohort[];
  groups: OverviewGroup[];
  teaching: LeadershipDetailRow[];
  versions: OverviewVersion[];
  sessions: OverviewSession[];
}
export interface DepartmentOverview {
  id: string;
  name: string;
  programs: number;
  groups: number;
  requiredHours: number | null;
  theoryHours: number | null;
  practicalHours: number | null;
  otherHours: number | null;
  scheduledHours: number | null;
  coveredHours: number | null;
}
export interface OverviewRoom {
  id: string;
  name: string;
  category: "hall" | "lab" | null;
  type: string;
  seats: number | null;
  capacityHours: number | null;
  occupiedHours: number | null;
  freeHours: number | null;
  utilization: number | null;
  sessions: number | null;
  hostedHours: number | null;
  outsideHours: number | null;
  overlapHours: number | null;
  issue: string | null;
}
export interface ResourceOverview {
  count: number;
  seats: number | null;
  capacityHours: number | null;
  occupiedHours: number | null;
  freeHours: number | null;
  utilization: number | null;
  usedCount: number | null;
  unusedCount: number | null;
}
export interface CollegeOverview {
  id: string;
  name: string;
  code: string;
  source: OverviewVersion | null;
  sourceNote: string | null;
  departments: DepartmentOverview[];
  departmentCount: number;
  programCount: number;
  courseCount: number;
  groups: number;
  requiredHours: number | null;
  scheduledHours: number | null;
  sessionCount: number | null;
  theoryHours: number | null;
  practicalHours: number | null;
  otherHours: number | null;
  coveredHours: number | null;
  facultyCount: number | null;
  activeFacultyCount: number | null;
  contributors: number | null;
  externalContributors: number | null;
  ranks: Record<string, number>;
  availability: Record<string, number>;
  rooms: OverviewRoom[];
  halls: ResourceOverview;
  labs: ResourceOverview;
  otherRooms: ResourceOverview;
  hostedElsewhereHours: number | null;
  issues: string[];
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const practical = new Set(["lab", "practical", "clinical", "field_training"]);
const theory = new Set(["theory", "lecture", "tutorial"]);
export const overviewNumber = (n: number | null | undefined) =>
  n == null ? "غير محسوب" : n.toLocaleString("ar", { maximumFractionDigits: 1 });

/** Unknown values remain unknown; neither unavailable schedules nor RLS-limited reads become zero. */
export function completeSum(values: Array<number | null | undefined>): number | null {
  return values.every(known) ? round((values as number[]).reduce((n, v) => n + v, 0)) : null;
}
export function sessionHours(s: Pick<OverviewSession, "start_time" | "end_time">): number {
  const h = (minutes(s.end_time) - minutes(s.start_time)) / 60;
  if (h <= 0) throw new Error("مدة محاضرة غير صالحة في مصدر التقرير");
  return h;
}
function unique<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!row.id) throw new Error("سجل في التقرير دون هوية");
    const prior = byId.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row))
      throw new Error("تغيرت بيانات التقرير أثناء القراءة؛ أعد التحديث");
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** Latest ITCS working version only when its group/hour coverage matches current demand. */
export function selectOverviewSource(
  college: LeadershipCollege,
  code: string,
  versions: OverviewVersion[],
  sessions: OverviewSession[],
  teaching: LeadershipDetailRow[],
  mode: OverviewSourceMode,
): { version: OverviewVersion | null; note: string | null } {
  if (college.term_state !== "ready" || !college.term_id)
    return { version: null, note: "الفصل غير محدد بصورة موحدة لهذه الكلية" };
  const eligible = versions.filter(
    (v) =>
      v.college_id === college.college_id &&
      v.academic_term_id === college.term_id &&
      !v.disposable_test,
  );
  const published =
    eligible.find((v) => v.id === college.version_id && v.status === "published") ?? null;
  if (mode !== "presentation" || code.trim().toUpperCase() !== "ITCS")
    return { version: published, note: published ? null : "لا يوجد جدول منشور متاح لهذا الفصل" };
  const working = eligible
    .filter((v) => ["draft", "review", "approved"].includes(v.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const demand = teaching.filter((r) => r.college_id === college.college_id);
  for (const v of working) {
    const rows = unique(
      sessions.filter((s) => s.schedule_version_id === v.id && !s.replaced_by_split),
    );
    const byGroup = new Map<string, number>();
    for (const s of rows) {
      if (s.delivery_group_id)
        byGroup.set(s.delivery_group_id, (byGroup.get(s.delivery_group_id) ?? 0) + sessionHours(s));
    }
    const total = rows.reduce((n, s) => n + sessionHours(s), 0);
    if (
      demand.length > 0 &&
      known(college.required_hours) &&
      Math.abs(total - college.required_hours) < 0.01 &&
      demand.every(
        (g) =>
          known(g.required_hours) &&
          Math.abs((byGroup.get(String(g.id)) ?? 0) - g.required_hours) < 0.01,
      )
    )
      return {
        version: v,
        note: "أحدث مسودة مكتملة الساعات والمجموعات؛ اكتمالها لا يعني اعتماد مواعيدها أو نشرها",
      };
  }
  return {
    version: published,
    note: working.length
      ? "استُخدم المنشور لأن المسودات المتاحة لا تطابق كامل المجموعات والساعات المطلوبة"
      : published
        ? "لا توجد مسودة عمل متاحة؛ استُخدم الجدول المنشور"
        : "لا توجد نسخة مكتملة متاحة",
  };
}

export function resourceSummary(rooms: OverviewRoom[], hasSource: boolean): ResourceOverview {
  const capacityHours = completeSum(rooms.map((r) => r.capacityHours));
  const occupiedHours = hasSource ? completeSum(rooms.map((r) => r.occupiedHours)) : null;
  const usageKnown = hasSource && rooms.every((r) => r.sessions !== null);
  return {
    count: physicalRoomGroups(rooms).length,
    seats: physicalSeatCount(rooms),
    capacityHours,
    occupiedHours,
    freeHours: hasSource ? completeSum(rooms.map((r) => r.freeHours)) : null,
    utilization:
      capacityHours && occupiedHours != null ? round((100 * occupiedHours) / capacityHours) : null,
    usedCount: usageKnown
      ? physicalRoomGroups(rooms).filter((group) => group.some((r) => r.sessions! > 0)).length
      : null,
    unusedCount: usageKnown
      ? physicalRoomGroups(rooms).filter((group) => group.every((r) => r.sessions === 0)).length
      : null,
  };
}

export function buildUniversityOverview(
  input: UniversityOverviewSources,
  mode: OverviewSourceMode,
): CollegeOverview[] {
  const authorized = new Set(input.colleges.map((c) => c.college_id));
  const groups = new Map(
    input.groups.filter((g) => authorized.has(g.college_id)).map((g) => [g.id, g]),
  );
  const cohorts = new Map(
    input.cohorts.filter((c) => authorized.has(c.college_id)).map((c) => [c.id, c]),
  );
  const programs = new Map(
    input.programs.filter((p) => authorized.has(p.college_id)).map((p) => [p.id, p]),
  );
  const departments = new Map(
    input.departments.filter((d) => authorized.has(d.college_id)).map((d) => [d.id, d]),
  );
  const teaching = input.teaching.filter((g) => authorized.has(String(g.college_id)));
  if (new Set(teaching.map((g) => g.id)).size !== teaching.length)
    throw new Error("تكررت مجموعات التدريس في التقرير");
  const allSessions = unique(
    input.sessions.filter((s) => authorized.has(s.college_id) && !s.replaced_by_split),
  );
  const code = (id: string) => input.collegeCodes.find((c) => c.id === id)?.code ?? "";
  const sources = new Map(
    input.colleges.map((c) => [
      c.college_id,
      selectOverviewSource(c, code(c.college_id), input.versions, allSessions, teaching, mode),
    ]),
  );
  const versionIds = new Set(
    [...sources.values()].flatMap((s) => (s.version ? [s.version.id] : [])),
  );
  const selectedSessions = allSessions.filter((s) => versionIds.has(s.schedule_version_id));
  const versionOwners = new Map(input.versions.map((v) => [v.id, v.college_id]));
  if (selectedSessions.some((s) => versionOwners.get(s.schedule_version_id) !== s.college_id))
    throw new Error("كلية المحاضرة لا تطابق كلية نسخة الجدول");
  const activeRooms = unique(
    input.rooms.filter((r) => r.is_active === true && authorized.has(r.college_id)),
  );
  const roomOwners = new Map(activeRooms.map((r) => [r.id, r.college_id]));
  function departmentFor(collegeId: string, cohortId: string | null, groupId: string | null) {
    const cohort = cohorts.get(cohortId ?? groups.get(groupId ?? "")?.cohort_id ?? "");
    const program = programs.get(cohort?.program_id ?? "");
    const dep = departments.get(program?.department_id ?? "");
    return dep?.college_id === collegeId ? dep : null;
  }
  return input.colleges
    .map((college): CollegeOverview => {
      const id = college.college_id;
      const chosen = sources.get(id)!;
      const ss = selectedSessions.filter(
        (s) => s.college_id === id && s.schedule_version_id === chosen.version?.id,
      );
      const demand = teaching.filter((g) => g.college_id === id);
      const issues: string[] = [];
      const demandHours = completeSum(
        demand.map((g) => (known(g.required_hours) ? g.required_hours : null)),
      );
      const demandComplete =
        college.term_state === "ready" &&
        known(college.required_hours) &&
        demandHours !== null &&
        Math.abs(demandHours - college.required_hours) < 0.01;
      if (!demandComplete)
        issues.push("تفاصيل الاحتياج التدريسي غير مكتملة أو تغيرت أثناء القراءة");
      const sourceComplete =
        !!chosen.version &&
        (chosen.version.status !== "published" ||
          (ss.length === college.sessions_count &&
            known(college.teaching_hours) &&
            Math.abs(ss.reduce((n, s) => n + sessionHours(s), 0) - college.teaching_hours) < 0.01));
      if (chosen.version?.status === "published" && !sourceComplete)
        issues.push("المحاضرات المقروءة لا تطابق عدد المنشور؛ أعد التحديث");
      const byDepartment = new Map<string, DepartmentOverview>();
      for (const d of input.departments.filter((d) => d.college_id === id && !d.is_archived)) {
        byDepartment.set(d.id, {
          id: d.id,
          name: d.name,
          programs: input.programs.filter((p) => p.department_id === d.id && !p.is_archived).length,
          groups: 0,
          requiredHours: demandComplete ? 0 : null,
          theoryHours: demandComplete ? 0 : null,
          practicalHours: demandComplete ? 0 : null,
          otherHours: demandComplete ? 0 : null,
          scheduledHours: sourceComplete ? 0 : null,
          coveredHours: demandComplete ? 0 : null,
        });
      }
      const depRow = (cohortId: string | null, groupId: string | null) => {
        const dep = departmentFor(id, cohortId, groupId);
        const key = dep?.id ?? "unresolved";
        let row = byDepartment.get(key);
        if (!row) {
          row = {
            id: key,
            name: dep ? `${dep.name} (مؤرشف)` : "ساعات لم تُربط بقسم",
            programs: 0,
            groups: 0,
            requiredHours: demandComplete ? 0 : null,
            theoryHours: demandComplete ? 0 : null,
            practicalHours: demandComplete ? 0 : null,
            otherHours: demandComplete ? 0 : null,
            scheduledHours: sourceComplete ? 0 : null,
            coveredHours: demandComplete ? 0 : null,
          };
          byDepartment.set(key, row);
        }
        return row;
      };
      for (const g of demand) {
        const row = depRow(null, String(g.id));
        row.groups += 1;
        if (demandComplete) {
          const h = Number(g.required_hours);
          row.requiredHours = round(row.requiredHours! + h);
          const key = theory.has(String(g.component_type))
            ? "theoryHours"
            : practical.has(String(g.component_type))
              ? "practicalHours"
              : "otherHours";
          row[key] = round(row[key]! + h);
          row.coveredHours =
            row.coveredHours === null || !known(g.covered_hours)
              ? null
              : round(row.coveredHours + g.covered_hours);
        }
      }
      for (const s of ss) {
        if (sourceComplete) {
          const row = depRow(s.cohort_id, s.delivery_group_id);
          row.scheduledHours = round(row.scheduledHours! + sessionHours(s));
        }
      }
      if (byDepartment.has("unresolved"))
        issues.push("بعض الساعات تحتاج ربطًا بالقسم؛ أُبقيت ظاهرة ولم تُحذف من الإجمالي");
      const settings = input.settings.filter((s) => s.college_id === id);
      const owned = activeRooms.filter((r) => r.college_id === id);
      const inventoryComplete = known(college.room_count) && owned.length === college.room_count;
      if (!inventoryComplete) issues.push("عدد الموارد المقروءة لا يطابق ملخص الكلية");
      const rooms = owned
        .map((room): OverviewRoom => {
          const type = input.roomTypes.find((t) => t.id === room.room_type_id);
          const assigned = selectedSessions.filter((s) => s.room_id === room.id);
          const physicalSessions = selectedSessions.filter(
            (s) => s.room_id && physicalRoomKey(s.room_id) === physicalRoomKey(room.id),
          );
          const result: OverviewRoom = {
            id: room.id,
            name: room.name ?? room.code ?? "مكان غير مسمى",
            type: type?.name_ar ?? "نوع غير محدد",
            category: type?.code ? roomCategoryFromType(type.code) : null,
            seats: known(room.capacity) ? room.capacity : null,
            capacityHours: null,
            occupiedHours: null,
            freeHours: null,
            utilization: null,
            sessions: sourceComplete && inventoryComplete ? assigned.length : null,
            hostedHours: sourceComplete
              ? round(
                  assigned
                    .filter((s) => s.college_id !== id)
                    .reduce((n, s) => n + sessionHours(s), 0),
                )
              : null,
            outsideHours: null,
            overlapHours: null,
            issue: null,
          };
          try {
            if (settings.length !== 1 || !inventoryComplete)
              throw new Error("إتاحة المكان غير مكتملة");
            const metrics = roomUtilizationMetrics({
              settings: settings[0],
              room,
              availability: input.availability.filter((a) => a.room_id === room.id),
              sessions: sourceComplete ? assigned : [],
            });
            result.capacityHours = metrics.available_hours;
            if (sourceComplete) {
              const physicalMetrics = roomUtilizationMetrics({
                settings: settings[0],
                room,
                availability: input.availability.filter((a) => a.room_id === room.id),
                sessions: physicalSessions,
              });
              if (
                !physicalRoomSourcesComplete(
                  room.id,
                  activeRooms.filter((r) => sources.get(r.college_id)?.version).map((r) => r.id),
                )
              ) {
                result.issue = "إشغال القاعة المشتركة يحتاج جداول جميع الكليات المشاركة";
                return result;
              }
              result.occupiedHours = physicalMetrics.occupied_hours;
              result.freeHours = physicalMetrics.idle_hours;
              result.utilization = physicalMetrics.utilization_pct;
              result.outsideHours = metrics.outside_hours;
              result.overlapHours = metrics.overlap_hours;
              if (metrics.outside_hours || metrics.overlap_hours)
                result.issue = `${metrics.outside_hours} ساعة خارج الإتاحة و${metrics.overlap_hours} ساعة متداخلة`;
            }
          } catch {
            result.issue = "بيانات إتاحة المكان غير مكتملة أو غير صالحة";
          }
          return result;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ar", { numeric: true }));
      const roomIssues = rooms.filter((r) => r.issue);
      if (roomIssues.length)
        issues.push(
          `${roomIssues.length} من القاعات والمعامل لديها ملاحظات على الإتاحة أو الإشغال`,
        );
      const deps = [...byDepartment.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
      return {
        id,
        name: college.college,
        code: code(id),
        source: chosen.version,
        sourceNote: chosen.note,
        departments: deps,
        departmentCount: input.departments.filter((d) => d.college_id === id && !d.is_archived)
          .length,
        programCount: input.programs.filter((p) => p.college_id === id && !p.is_archived).length,
        courseCount: new Set(demand.map((g) => g.course_code ?? g.course)).size,
        groups: demand.length,
        requiredHours: demandComplete ? demandHours : null,
        coveredHours: demandComplete
          ? completeSum(demand.map((g) => (known(g.covered_hours) ? g.covered_hours : null)))
          : null,
        scheduledHours: sourceComplete ? round(ss.reduce((n, s) => n + sessionHours(s), 0)) : null,
        sessionCount: sourceComplete ? ss.length : null,
        theoryHours: demandComplete ? completeSum(deps.map((d) => d.theoryHours)) : null,
        practicalHours: demandComplete ? completeSum(deps.map((d) => d.practicalHours)) : null,
        otherHours: demandComplete ? completeSum(deps.map((d) => d.otherHours)) : null,
        facultyCount: college.faculty_directory_count,
        activeFacultyCount: college.faculty_count,
        contributors: college.teaching_contributors,
        externalContributors: college.external_contributors,
        ranks: college.rank_counts,
        availability: college.availability_counts,
        rooms,
        halls: resourceSummary(
          rooms.filter((r) => r.category === "hall"),
          sourceComplete,
        ),
        labs: resourceSummary(
          rooms.filter((r) => r.category === "lab"),
          sourceComplete,
        ),
        otherRooms: resourceSummary(
          rooms.filter((r) => r.category === null),
          sourceComplete,
        ),
        hostedElsewhereHours: sourceComplete
          ? round(
              ss
                .filter(
                  (s) => s.room_id && roomOwners.has(s.room_id) && roomOwners.get(s.room_id) !== id,
                )
                .reduce((n, s) => n + sessionHours(s), 0),
            )
          : null,
        issues,
      };
    })
    .sort(
      (a, b) =>
        Number(b.code === "ITCS") - Number(a.code === "ITCS") || a.name.localeCompare(b.name, "ar"),
    );
}

export function summarizeUniversityOverview(
  rows: CollegeOverview[],
  uniqueFaculty?: number | null,
) {
  const demandRows = rows.filter((c) => c.requiredHours !== null);
  const scheduleRows = rows.filter((c) => c.scheduledHours !== null && c.sessionCount !== null);
  return {
    requiredScope: demandRows.length,
    scheduledScope: scheduleRows.length,
    colleges: rows.length,
    departments: rows.reduce((n, c) => n + c.departmentCount, 0),
    programs: rows.reduce((n, c) => n + c.programCount, 0),
    requiredHours: demandRows.length ? completeSum(demandRows.map((c) => c.requiredHours)) : null,
    scheduledHours: scheduleRows.length
      ? completeSum(scheduleRows.map((c) => c.scheduledHours))
      : null,
    sessions: scheduleRows.length ? completeSum(scheduleRows.map((c) => c.sessionCount)) : null,
    faculty:
      uniqueFaculty === undefined ? completeSum(rows.map((c) => c.facultyCount)) : uniqueFaculty,
    halls: resourceSummary(
      rows.flatMap((c) => c.rooms.filter((r) => r.category === "hall")),
      scheduleRows.length > 0 &&
        rows.filter((c) => c.halls.count > 0).every((c) => c.sessionCount !== null),
    ),
    labs: resourceSummary(
      rows.flatMap((c) => c.rooms.filter((r) => r.category === "lab")),
      scheduleRows.length > 0 &&
        rows.filter((c) => c.labs.count > 0).every((c) => c.sessionCount !== null),
    ),
    drafts: rows.filter((c) => c.source && c.source.status !== "published").length,
    notes: rows.reduce((n, c) => n + c.issues.length, 0),
  };
}
