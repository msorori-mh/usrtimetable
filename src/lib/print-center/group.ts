import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";
import { sortPrintSessions } from "./filters";
import type {
  PrintCenterFilters,
  PrintPageGroup,
  PrintSessionLike,
  PrintStudySystem,
} from "./types";

function pageStudyKey(sys: string | null | undefined): "regular" | "parallel" | "both" {
  const s = sys ?? "regular";
  if (s === "parallel") return "parallel";
  if (s === "both") return "both";
  return "regular";
}

function studyLabel(sys: string): string {
  if (sys === "both") return "مشترك (انتظام/موازي)";
  return STUDY_SYSTEM_LABELS[sys as ReportStudySystem] ?? sys;
}

function programName(s: PrintSessionLike): string {
  return s.course_offerings?.academic_programs?.name ?? "برنامج غير محدد";
}

function levelName(s: PrintSessionLike): string {
  return s.course_offerings?.academic_levels?.name ?? "مستوى غير محدد";
}

function departmentName(s: PrintSessionLike): string {
  return s.course_offerings?.courses?.departments?.name ?? "قسم غير محدد";
}

function instructorName(s: PrintSessionLike): string {
  return s.instructors?.full_name ?? "مدرس غير محدد";
}

function roomLabel(s: PrintSessionLike): string {
  if (!s.rooms) return "قاعة غير محددة";
  return `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}`.trim() || "قاعة غير محددة";
}

/**
 * Group filtered sessions into print pages.
 * - student / level: single page
 * - program: separate page per level + study system
 * - department: separate page per program + study system
 * - instructor: one page (or per instructor if none selected)
 * - room: one page (or per room if none selected)
 * Regular and parallel are always separated into distinct pages when grouping.
 */
export function groupPrintPages(
  sessions: PrintSessionLike[],
  filters: PrintCenterFilters,
): PrintPageGroup[] {
  const sorted = sortPrintSessions(sessions);
  if (sorted.length === 0) return [];

  const buckets = new Map<string, PrintSessionLike[]>();

  const push = (key: string, s: PrintSessionLike) => {
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  };

  for (const s of sorted) {
    switch (filters.reportType) {
      case "student":
      case "level": {
        const sys = pageStudyKey(s.study_system);
        // Keep regular/parallel on separate pages even for single-filter student views
        // when study system is "all"; otherwise one page.
        if (filters.studySystem && filters.studySystem !== "all") {
          push("single", s);
        } else {
          push(`sys:${sys}`, s);
        }
        break;
      }
      case "program": {
        const lid = s.course_offerings?.level_id ?? "none";
        const sys = pageStudyKey(s.study_system);
        // "both" sessions appear on both regular and parallel pages when separating
        if (sys === "both") {
          push(`lvl:${lid}|sys:regular`, s);
          push(`lvl:${lid}|sys:parallel`, s);
        } else {
          push(`lvl:${lid}|sys:${sys}`, s);
        }
        break;
      }
      case "department": {
        const pid = s.course_offerings?.program_id ?? "none";
        const sys = pageStudyKey(s.study_system);
        if (sys === "both") {
          push(`prog:${pid}|sys:regular`, s);
          push(`prog:${pid}|sys:parallel`, s);
        } else {
          push(`prog:${pid}|sys:${sys}`, s);
        }
        break;
      }
      case "instructor": {
        if (filters.instructorId) push("single", s);
        else push(`ins:${s.instructor_id ?? "none"}`, s);
        break;
      }
      case "room": {
        if (filters.roomId) push("single", s);
        else push(`room:${s.room_id ?? "none"}`, s);
        break;
      }
      default:
        push("single", s);
    }
  }

  const pages: PrintPageGroup[] = [];
  for (const [key, list] of buckets) {
    const sample = list[0]!;
    let title = "الجدول الدراسي";
    let studySystem: PrintStudySystem | "both" | string | undefined;

    if (key.startsWith("lvl:")) {
      const sys = key.split("|sys:")[1] as PrintStudySystem;
      studySystem = sys;
      title = `${programName(sample)} — ${levelName(sample)} — ${studyLabel(sys)}`;
      pages.push({
        key,
        title,
        programName: programName(sample),
        levelName: levelName(sample),
        studySystem,
        sessions: list,
      });
      continue;
    }
    if (key.startsWith("prog:")) {
      const sys = key.split("|sys:")[1] as PrintStudySystem;
      studySystem = sys;
      title = `${departmentName(sample)} — ${programName(sample)} — ${studyLabel(sys)}`;
      pages.push({
        key,
        title,
        departmentName: departmentName(sample),
        programName: programName(sample),
        studySystem,
        sessions: list,
      });
      continue;
    }
    if (key.startsWith("ins:")) {
      title = `جدول المدرس — ${instructorName(sample)}`;
      pages.push({
        key,
        title,
        instructorName: instructorName(sample),
        sessions: list,
      });
      continue;
    }
    if (key.startsWith("room:")) {
      title = `جدول القاعة — ${roomLabel(sample)}`;
      pages.push({
        key,
        title,
        roomLabel: roomLabel(sample),
        sessions: list,
      });
      continue;
    }
    if (key.startsWith("sys:")) {
      const sys = key.slice(4);
      studySystem = sys;
      title = `${levelName(sample)} — ${studyLabel(sys)}`;
      pages.push({
        key,
        title,
        levelName: levelName(sample),
        programName: programName(sample),
        studySystem,
        sessions: list,
      });
      continue;
    }

    // single
    pages.push({
      key,
      title,
      programName: programName(sample),
      levelName: levelName(sample),
      departmentName: departmentName(sample),
      instructorName: filters.reportType === "instructor" ? instructorName(sample) : undefined,
      roomLabel: filters.reportType === "room" ? roomLabel(sample) : undefined,
      studySystem: filters.studySystem ?? undefined,
      sessions: list,
    });
  }

  return pages.sort((a, b) => a.key.localeCompare(b.key));
}
