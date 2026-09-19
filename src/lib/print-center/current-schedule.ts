/**
 * CURRENT-SCHEDULE-PRINT-01 — pure grouping for «طباعة الجدول الحالي».
 *
 * Prints the FULL current schedule version with no silent drops: every session of
 * the version lands on exactly one printable page, grouped operationally by
 * program → level → study system (student groups stay visible in the group column).
 *
 * Read-only: nothing here writes scheduling data.
 */
import { groupPrintPages } from "./group";
import type {
  PrintPageGroup,
  PrintSessionLike,
  PrintStudySystem,
} from "./types";

export const CURRENT_SCHEDULE_TITLE_AR = "طباعة الجدول الحالي";

const SYSTEM_ORDER: Record<string, number> = {
  regular: 0,
  parallel: 1,
  both: 2,
};

function programKey(s: PrintSessionLike): string {
  return s.intake_study_plan_id
    ? `${s.course_offerings?.program_id ?? "none"}:${s.intake_study_plan_id}`
    : (s.course_offerings?.program_id ?? "none");
}

function levelNumber(s: PrintSessionLike): number {
  return s.course_offerings?.academic_levels?.level_number ?? 999;
}

/**
 * Group every session of the current version into print pages.
 * One page per program + level + study system, ordered program → level → system.
 */
export function groupCurrentSchedulePages(
  sessions: PrintSessionLike[],
  opts: { collegeId: string; studySystem?: PrintStudySystem },
): PrintPageGroup[] {
  const byProgram = new Map<string, PrintSessionLike[]>();
  for (const s of sessions) {
    const key = programKey(s);
    const list = byProgram.get(key);
    if (list) list.push(s);
    else byProgram.set(key, [s]);
  }

  const pages: PrintPageGroup[] = [];
  for (const [pid, list] of byProgram) {
    const grouped = groupPrintPages(list, {
      reportType: "program",
      collegeId: opts.collegeId,
      studySystem: opts.studySystem ?? "all",
    });
    for (const page of grouped) {
      pages.push({
        ...page,
        key: `${pid}:${page.key}`,
        title: `جدول ${page.title}`,
        departmentName:
          page.departmentName ??
          page.sessions[0]?.course_offerings?.courses?.departments?.name ??
          undefined,
      });
    }
  }

  return pages.sort((a, b) => {
    const p = (a.programName ?? "").localeCompare(b.programName ?? "", "ar");
    if (p !== 0) return p;
    const lv = levelNumber(a.sessions[0]!) - levelNumber(b.sessions[0]!);
    if (lv !== 0) return lv;
    return (
      (SYSTEM_ORDER[String(a.studySystem)] ?? 9) -
      (SYSTEM_ORDER[String(b.studySystem)] ?? 9)
    );
  });
}

/** Guard used by the UI/tests: printed sessions must equal fetched sessions. */
export function countPagedSessions(pages: PrintPageGroup[]): number {
  const ids = new Set<string>();
  for (const p of pages) for (const s of p.sessions) ids.add(s.id);
  return ids.size;
}
