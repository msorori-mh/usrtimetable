/**
 * LAUNCH-CLOSURE-03 print/export proof — FIXTURE DATA ONLY.
 *
 * Nothing here touches the database. The shapes are the real `PrintSessionLike`
 * contract, so the fixture flows through the real `groupPrintPages`,
 * `sessionToExportRow`, `buildExportRows`, `PrintSheet` and the real download
 * helpers without any reimplementation of layout or export logic.
 *
 * FIXTURE_COLLEGE_ID is a synthetic uuid; it matches no production college.
 */
import type { PrintCenterFilters, PrintSessionLike } from "@/lib/print-center";

export const FIXTURE_COLLEGE_ID = "00000000-0000-4000-8000-00000000f1x7";

/** Mirrors the shape of the published TEST-SIMP-03 schedule: practical Sun, theory Mon. */
export const SHORT_FIXTURE: PrintSessionLike[] = [
  {
    id: "fx-short-1",
    college_id: FIXTURE_COLLEGE_ID,
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "practical",
    study_system: "regular",
    updated_at: "2026-09-08T09:15:00.000Z",
    course_offerings: {
      program_id: "fx-prog-1",
      level_id: "fx-level-1",
      courses: {
        code: "FX-C101",
        name: "مقدمة في علوم الحاسوب",
        department_id: "fx-dept-1",
        departments: { name: "قسم علوم الحاسوب" },
      },
      academic_programs: { name: "بكالوريوس علوم الحاسوب" },
      academic_levels: { name: "المستوى الأول", level_number: 1 },
    },
    instructors: { full_name: "د. عبد الرحمن الشرعبي" },
    rooms: { code: "LAB-1", name: "مختبر الحاسوب الأول" },
  },
  {
    id: "fx-short-2",
    college_id: FIXTURE_COLLEGE_ID,
    day_of_week: 1,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "theory",
    study_system: "regular",
    updated_at: "2026-09-08T09:15:00.000Z",
    course_offerings: {
      program_id: "fx-prog-1",
      level_id: "fx-level-1",
      courses: {
        code: "FX-C101",
        name: "مقدمة في علوم الحاسوب",
        department_id: "fx-dept-1",
        departments: { name: "قسم علوم الحاسوب" },
      },
      academic_programs: { name: "بكالوريوس علوم الحاسوب" },
      academic_levels: { name: "المستوى الأول", level_number: 1 },
    },
    instructors: { full_name: "د. عبد الرحمن الشرعبي" },
    rooms: { code: "H-201", name: "قاعة المحاضرات ٢٠١" },
  },
];

const LONG_COURSE_NAMES = [
  "أساسيات هندسة البرمجيات وتحليل النظم المتقدمة",
  "قواعد البيانات الموزّعة وتحسين الاستعلامات",
  "شبكات الحاسوب وبروتوكولات الاتصال الحديثة",
  "الذكاء الاصطناعي وتعلّم الآلة التطبيقي",
  "أمن المعلومات والتشفير وحماية البنية التحتية الرقمية",
  "هندسة المتطلّبات وإدارة مشاريع تقنية المعلومات",
];
const LONG_INSTRUCTORS = [
  "أ.د. محمد عبدالله الحكيمي",
  "د. سارة أحمد المقطري",
  "د. عبدالسلام ناجي الشميري",
  "أ. فاطمة صالح العريقي",
];
const LONG_ROOMS = [
  { code: "H-101", name: "قاعة المحاضرات الكبرى رقم ١٠١" },
  { code: "LAB-3", name: "مختبر الشبكات والأنظمة الموزّعة" },
  { code: "H-305", name: "قاعة الدراسات العليا ٣٠٥" },
];

/**
 * Long Arabic multi-page fixture: 4 levels x 30 sessions. Deliberately long Arabic
 * course names, instructor names and room names, so cell wrapping, repeated table
 * headers across printed pages, and page breaks are all exercised.
 */
export const LONG_FIXTURE: PrintSessionLike[] = Array.from({ length: 120 }, (_, i) => {
  const level = Math.floor(i / 30) + 1;
  const day = i % 6;
  const hour = 8 + (i % 5) * 2;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id: `fx-long-${i + 1}`,
    college_id: FIXTURE_COLLEGE_ID,
    day_of_week: day,
    start_time: `${pad(hour)}:00:00`,
    end_time: `${pad(hour + 2)}:00:00`,
    session_type: i % 3 === 0 ? "practical" : "theory",
    study_system: i % 2 === 0 ? "regular" : "parallel",
    updated_at: "2026-09-09T18:00:00.000Z",
    course_offerings: {
      program_id: "fx-prog-1",
      level_id: `fx-level-${level}`,
      courses: {
        code: `FX-C${level}${pad((i % 30) + 1)}`,
        name: LONG_COURSE_NAMES[i % LONG_COURSE_NAMES.length],
        department_id: "fx-dept-1",
        departments: { name: "قسم تكنولوجيا المعلومات وعلوم الحاسوب" },
      },
      academic_programs: { name: "بكالوريوس تكنولوجيا المعلومات وعلوم الحاسوب" },
      academic_levels: { name: `المستوى ${level}`, level_number: level },
    },
    instructors: { full_name: LONG_INSTRUCTORS[i % LONG_INSTRUCTORS.length] },
    rooms: LONG_ROOMS[i % LONG_ROOMS.length],
  } satisfies PrintSessionLike;
});

/**
 * Program report: requires programId only, so every level of the fixture programme is
 * printed and the real grouping splits the sheet into one page per level.
 */
export const FIXTURE_FILTERS: PrintCenterFilters = {
  reportType: "program",
  collegeId: FIXTURE_COLLEGE_ID,
  programId: "fx-prog-1",
  levelId: null,
  studySystem: "all",
};
