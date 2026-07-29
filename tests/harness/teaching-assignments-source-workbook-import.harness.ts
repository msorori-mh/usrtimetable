/**
 * TEACHING-ASSIGNMENTS-SOURCE-WORKBOOK-BULK-IMPORT-01 harness.
 * Synthetic fixture — no DB writes.
 */
import {
  canonicalCourseCodeKey,
  courseNameMatchKey,
  instructorMatchKey,
  normalizeArabicText,
  normalizedMatchKey,
  stripAcademicHonorifics,
} from "../../src/lib/excel-import/arabic-normalize";
import { resolveProgramField } from "../../src/lib/excel-import/program-aliases";
import {
  detectTeachingImportWorkbookMode,
  isSourceWorkbookHeaderRow,
  isTotalOrSummaryRow,
} from "../../src/lib/excel-import/teaching-assignments-source-schema";
import {
  parseSourceSheetMatrix,
  parseSourceWorkbookFromSheets,
} from "../../src/lib/excel-import/teaching-assignments-source-parser";
import {
  resolveSourceTeachingAssignments,
  sourcePreviewToValidatedRows,
  type SourceResolverContext,
} from "../../src/lib/excel-import/teaching-assignments-source-resolver";
import { anonymizedRealWorkbookSheet } from "../fixtures/teaching-assignments-source/anonymized-real-layout";
import {
  stage03cAnonymousMatchingCases,
  stage03cLivePreviewDistribution,
} from "../fixtures/teaching-assignments-source/stage-03c-live-preview-anonymized";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function buildSyntheticContext(): SourceResolverContext {
  return {
    instructors: [
      {
        id: "ins-1",
        employee_number: "EMP001",
        full_name_ar: "أحمد محمد",
        full_name: "Ahmad",
      },
      {
        id: "ins-2",
        employee_number: "EMP002",
        full_name_ar: "سارة علي",
        full_name: "Sara",
      },
    ],
    programs: [
      { id: "p-cs", code: "CS" },
      { id: "p-cis", code: "CIS" },
      { id: "p-it", code: "IT" },
      { id: "p-cyb", code: "CYB" },
    ],
    courses: [
      { id: "c-cs101", code: "CS101", name: "مقدمة في البرمجة" },
      { id: "c-cs102", code: "CS102", name: "هياكل البيانات" },
      { id: "c-shared", code: "UNI100", name: "مهارات التواصل" },
      { id: "c-cis-cs101", code: "CS101", name: "مقرر مختلف بنفس الرمز" },
    ],
    levels: [
      { id: "l-cs-1", program_id: "p-cs", level_number: 1 },
      { id: "l-cs-2", program_id: "p-cs", level_number: 2 },
      { id: "l-cis-1", program_id: "p-cis", level_number: 1 },
      { id: "l-it-1", program_id: "p-it", level_number: 1 },
      { id: "l-cyb-1", program_id: "p-cyb", level_number: 1 },
    ],
    terms: [
      { id: "term-f1", code: "2026-F1", term_type: "first" },
      { id: "term-f2", code: "2026-F2", term_type: "second" },
    ],
    studyPlans: [
      { id: "sp-cs", program_id: "p-cs", is_active: true },
      { id: "sp-cis", program_id: "p-cis", is_active: true },
      { id: "sp-it", program_id: "p-it", is_active: true },
      { id: "sp-cyb", program_id: "p-cyb", is_active: true },
    ],
    planCourses: [
      {
        id: "pc-cs101",
        study_plan_id: "sp-cs",
        course_id: "c-cs101",
        level_id: "l-cs-1",
        semester: 1,
      },
      {
        id: "pc-cs102-theory",
        study_plan_id: "sp-cs",
        course_id: "c-cs102",
        level_id: "l-cs-2",
        semester: 1,
      },
      {
        id: "pc-uni-cs",
        study_plan_id: "sp-cs",
        course_id: "c-shared",
        level_id: "l-cs-1",
        semester: 1,
      },
      {
        id: "pc-uni-cis",
        study_plan_id: "sp-cis",
        course_id: "c-shared",
        level_id: "l-cis-1",
        semester: 1,
      },
      {
        id: "pc-cis-duplicate-code",
        study_plan_id: "sp-cis",
        course_id: "c-cis-cs101",
        level_id: "l-cis-1",
        semester: 1,
      },
    ],
    components: [
      {
        id: "comp-cs101-t",
        plan_course_id: "pc-cs101",
        component_type: "theory",
        weekly_contact_hours: 3,
        is_timetabled: true,
      },
      {
        id: "comp-cs102-t",
        plan_course_id: "pc-cs102-theory",
        component_type: "theory",
        weekly_contact_hours: 2,
        is_timetabled: true,
      },
      {
        id: "comp-cs102-p",
        plan_course_id: "pc-cs102-theory",
        component_type: "practical",
        weekly_contact_hours: 2,
        is_timetabled: true,
      },
      {
        id: "comp-cs102-st",
        plan_course_id: "pc-cs102-theory",
        component_type: "summer_training",
        weekly_contact_hours: 0,
        is_timetabled: false,
      },
      {
        id: "comp-uni-cis-t",
        plan_course_id: "pc-uni-cis",
        component_type: "theory",
        weekly_contact_hours: 2,
        is_timetabled: true,
      },
      {
        id: "comp-uni-t",
        plan_course_id: "pc-uni-cs",
        component_type: "theory",
        weekly_contact_hours: 2,
        is_timetabled: true,
      },
    ],
    cohorts: [
      {
        id: "coh-cs-r",
        code: "CS-L1-2026-R",
        program_id: "p-cs",
        level_id: "l-cs-1",
        study_system: "regular",
        term_id: "term-f1",
        active: true,
      },
      {
        id: "coh-cs-p",
        code: "CS-L1-2026-P",
        program_id: "p-cs",
        level_id: "l-cs-1",
        study_system: "parallel",
        term_id: "term-f1",
        active: true,
      },
      {
        id: "coh-cs2-r",
        code: "CS-L2-2026-R",
        program_id: "p-cs",
        level_id: "l-cs-2",
        study_system: "regular",
        term_id: "term-f1",
        active: true,
      },
      {
        id: "coh-cis-r",
        code: "CIS-L1-2026-R",
        program_id: "p-cis",
        level_id: "l-cis-1",
        study_system: "regular",
        term_id: "term-f1",
        active: true,
      },
    ],
    deliveryGroups: [
      {
        id: "dg-cs101",
        cohort_id: "coh-cs-r",
        component_id: "comp-cs101-t",
        group_code: "G1",
        plan_course_id: "pc-cs101",
        is_obsolete: false,
        active: true,
      },
      {
        id: "dg-cs101-p",
        cohort_id: "coh-cs-p",
        component_id: "comp-cs101-t",
        group_code: "G1",
        plan_course_id: "pc-cs101",
        is_obsolete: false,
        active: true,
      },
      {
        id: "dg-cs102-t",
        cohort_id: "coh-cs2-r",
        component_id: "comp-cs102-t",
        group_code: "G1",
        plan_course_id: "pc-cs102-theory",
        is_obsolete: false,
        active: true,
      },
      {
        id: "dg-cs102-p",
        cohort_id: "coh-cs2-r",
        component_id: "comp-cs102-p",
        group_code: "G1",
        plan_course_id: "pc-cs102-theory",
        is_obsolete: false,
        active: true,
      },
      {
        id: "dg-uni-cs",
        cohort_id: "coh-cs-r",
        component_id: "comp-uni-t",
        group_code: "G1",
        plan_course_id: "pc-uni-cs",
        is_obsolete: false,
        active: true,
      },
      {
        id: "dg-uni-cis",
        cohort_id: "coh-cis-r",
        component_id: "comp-uni-cis-t",
        group_code: "G1",
        plan_course_id: "pc-uni-cis",
        is_obsolete: false,
        active: true,
      },
    ],
  };
}

function run() {
  // Arabic normalization
  assert(
    normalizedMatchKey("علوم  حاسوب") === normalizedMatchKey("علوم حاسوب"),
    "spaces collapsed",
  );
  assert(normalizedMatchKey("أحمد") === normalizedMatchKey("احمد"), "alef normalized");
  assert(
    new Set(stage03cAnonymousMatchingCases.courseCodes.map(canonicalCourseCodeKey)).size === 1,
    "course codes normalize spaces, punctuation, width and Arabic/Persian digits",
  );
  assert(
    new Set(stage03cAnonymousMatchingCases.courseNames.map(courseNameMatchKey)).size === 1,
    "course names normalize spacing and punctuation without fuzzy matching",
  );
  assert(
    instructorMatchKey("أحمد، محمد") === instructorMatchKey("احمدمحمد"),
    "instructor punctuation and spacing normalize",
  );
  assert(
    stripAcademicHonorifics("أ.م.د. مقبول قايد عبده الكامل") === "مقبول قايد عبده الكامل",
    "strip أ.م.د. honorific",
  );
  assert(
    instructorMatchKey("د. اسامه عبدالجليل احمد سيف") ===
      instructorMatchKey("اسامه عبدالجليل احمد سيف"),
    "instructor key ignores د.",
  );

  // Program aliases + compound
  assert(resolveProgramField("علوم حاسوب").kind === "codes", "cs alias");
  assert(
    resolveProgramField("علوم حاسوب+نظم معلومات").kind === "codes" &&
      (resolveProgramField("علوم حاسوب+نظم معلومات") as { codes: string[] }).codes.length === 2,
    "compound split",
  );
  assert(resolveProgramField("جميع الأقسام").kind === "all_departments", "all departments");
  assert(
    resolveProgramField("كل الاقسام مع الجوف").kind === "all_departments",
    "real workbook all-departments campus alias",
  );
  assert(resolveProgramField("امن سبراني").kind === "codes", "documented CYB spelling");
  assert(
    resolveProgramField("علوم حاسوب + نظم + الجوف").kind === "codes" &&
      (resolveProgramField("علوم حاسوب + نظم + الجوف") as { codes: string[] }).codes.length === 2,
    "known campus qualifier is ignored without guessing a program",
  );
  assert(resolveProgramField("علوم").kind === "unknown", "partial labels never guess");
  assert(resolveProgramField("برنامج مجهول").kind === "unknown", "unknown program");

  // Mode detection
  assert(
    detectTeachingImportWorkbookMode([
      ["رمز_الدفعة", "رمز_المقرر", "نوع_المكوّن", "رمز_مجموعة_التقديم", "رقم_الموظف_للمحاضر"],
    ]) === "official_template",
    "official template detected",
  );
  assert(
    detectTeachingImportWorkbookMode([
      ["م", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
    ]) === "academic_source_workbook",
    "source workbook detected",
  );

  // Parser: carry-forward, skip totals, duplicate headers
  const sheet1 = [
    ["م", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
    ["1", "أحمد محمد", "مقدمة في البرمجة", "1", "علوم حاسوب", "3", ""],
    ["", "", "", "", "", "", ""],
    ["2", "", "CS102", "2", "علوم حاسوب", "4", ""],
    ["", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
    ["", "", "", "", "اجمالي الساعات", "7", ""],
  ];
  const parsed1 = parseSourceSheetMatrix("اسناد الفصل الاول 2026", sheet1);
  assert(parsed1.dataRowCount === 2, "two data rows");
  assert(parsed1.rows[1].courseName === "CS102", "course carry-forward not needed row2");
  assert(parsed1.rows[1].instructorName === "أحمد محمد", "instructor carry-forward");
  const arabicNumericCells = parseSourceSheetMatrix("S", [
    ["م", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
    ["١", "محاضر اختباري", "CS-١٠١", "٢", "علوم حاسوب", "٣", ""],
  ]);
  assert(arabicNumericCells.rows[0].levelNumber === 2, "Arabic level digit parsed");
  assert(arabicNumericCells.rows[0].totalHours === 3, "Arabic hours digit parsed");

  const realLayout = parseSourceSheetMatrix("اسناد الفصل الاول 2026", anonymizedRealWorkbookSheet);
  assert(realLayout.rows[1].programRaw === "علوم حاسوب", "program carry-forward");
  assert(realLayout.rows[1].levelNumber === 2, "level carry-forward");
  assert(realLayout.rows[1].courseName === "هياكل البيانات", "course carry-forward");

  assert(isSourceWorkbookHeaderRow(["م", "الاسم", "اسم المادة", "البرنامج"]), "header detect");
  assert(isTotalOrSummaryRow({ البرنامج: "اجمالي الساعات" }), "total row");

  const wb = parseSourceWorkbookFromSheets([
    { name: "اسناد الفصل الاول 2026", matrix: sheet1 },
    {
      name: "اسناد الفصل الثاني 2026",
      matrix: [
        ["م", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
        ["1", "سارة علي", "مهارات التواصل", "1", "جميع الأقسام", "2", ""],
      ],
    },
    { name: "تعليمات", matrix: [["ignored"]] },
  ]);
  assert(wb.sheets.length === 2, "reads all non-metadata sheets");

  const ctx = buildSyntheticContext();
  const rows = wb.sheets.flatMap((s) => s.rows);
  const preview = resolveSourceTeachingAssignments({
    rows,
    ctx,
    sheetTermMap: {
      "اسناد الفصل الاول 2026": "term-f1",
      "اسناد الفصل الثاني 2026": "term-f1",
    },
    studySystemScope: "both",
  });

  assert(preview.totals.matched > 0, "some matched");
  assert(
    preview.assignments.some((a) => a.outcome === "MATCHED" && a.courseCode === "CS101"),
    "CS101 matched inside program/level/term scope despite duplicate code elsewhere",
  );
  const arabicDigitCode = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 3,
        instructorName: "أحمد،محمد",
        courseName: "CS-١٠١",
        levelNumber: 1,
        programRaw: "علوم حاسوب",
        totalHours: 3,
        notes: null,
        ignored: false,
      },
    ],
    ctx,
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    arabicDigitCode.assignments.some((a) => a.outcome === "MATCHED" && a.courseCode === "CS101"),
    "formatted code and instructor punctuation do not cause false NOT_FOUND",
  );
  const formattedArabicName = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 4,
        instructorName: "أحمد محمد",
        courseName: "مقدمة،في-البرمجة",
        levelNumber: 1,
        programRaw: "علوم حاسوب",
        totalHours: 3,
        notes: null,
        ignored: false,
      },
    ],
    ctx,
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    formattedArabicName.assignments.some((a) => a.outcome === "MATCHED"),
    "formatted Arabic course name does not cause false NOT_FOUND",
  );
  assert(
    preview.assignments.some((a) => a.outcome === "MATCHED" && a.componentType === "theory"),
    "theory component",
  );
  assert(
    preview.assignments.some((a) => a.outcome === "MATCHED" && a.componentType === "practical"),
    "hours-sum expands to practical",
  );
  const cs102Expanded = preview.assignments.filter(
    (a) => a.outcome === "MATCHED" && a.courseCode === "CS102",
  );
  assert(
    cs102Expanded.length === 2 && cs102Expanded.every((a) => a.assignedComponentHours === 2),
    "expand_all emits each component's own server-valid hours",
  );
  assert(
    preview.assignments.filter((a) => a.outcome === "MATCHED" && a.courseCode === "UNI100")
      .length >= 2,
    "all departments expands",
  );
  assert(
    preview.assignments.some((a) => a.studySystem === "regular" && a.outcome === "MATCHED"),
    "regular system",
  );
  assert(
    preview.assignments.some((a) => a.studySystem === "parallel" && a.outcome === "MATCHED"),
    "parallel system both scope",
  );

  // Instructor not found
  const badIns = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 5,
        instructorName: "غير موجود",
        courseName: "CS101",
        levelNumber: 1,
        programRaw: "علوم حاسوب",
        totalHours: 3,
        notes: null,
        ignored: false,
      },
    ],
    ctx,
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    badIns.assignments.some((a) => a.errorCode === "instructor_not_found"),
    "no auto-create",
  );

  // BLOCKED delivery_groups
  const blockedCtx: SourceResolverContext = {
    ...ctx,
    deliveryGroups: [],
  };
  const blocked = resolveSourceTeachingAssignments({
    rows: [rows[0]],
    ctx: blockedCtx,
    sheetTermMap: { "اسناد الفصل الاول 2026": "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    blocked.assignments.some((a) => a.blockedDependency === "delivery_groups"),
    "blocked dg",
  );

  // AMBIGUOUS component hours
  const amb = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 6,
        instructorName: "أحمد محمد",
        courseName: "CS102",
        levelNumber: 2,
        programRaw: "علوم حاسوب",
        totalHours: 99,
        notes: null,
        ignored: false,
      },
    ],
    ctx,
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    amb.assignments.some((a) => a.outcome === "AMBIGUOUS"),
    "ambiguous hours",
  );

  const singleComponentHoursMismatch = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 7,
        instructorName: "أحمد محمد",
        courseName: "CS101",
        levelNumber: 1,
        programRaw: "علوم حاسوب",
        totalHours: 6,
        notes: null,
        ignored: false,
      },
    ],
    ctx,
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    singleComponentHoursMismatch.assignments.some(
      (assignment) =>
        assignment.outcome === "AMBIGUOUS" && assignment.message?.includes("ساعات المكوّن"),
    ),
    "single component does not accept source hours above weekly hours",
  );

  const officialInstructorAmbiguity = resolveSourceTeachingAssignments({
    rows: [
      {
        sheetName: "S",
        rowNumber: 7,
        instructorName: "أحمد محمد",
        courseName: "CS101",
        levelNumber: 1,
        programRaw: "علوم حاسوب",
        totalHours: 3,
        notes: null,
        ignored: false,
      },
    ],
    ctx: {
      ...ctx,
      instructors: [
        ...ctx.instructors,
        {
          id: "ins-duplicate",
          employee_number: "EMP099",
          full_name_ar: "أحمد،محمد",
          full_name: null,
        },
      ],
    },
    sheetTermMap: { S: "term-f1" },
    studySystemScope: "regular_only",
  });
  assert(
    officialInstructorAmbiguity.assignments.some(
      (a) => a.outcome === "AMBIGUOUS" && a.errorCode === "ambiguous_instructor",
    ),
    "true duplicate instructor remains AMBIGUOUS",
  );

  assert(
    stage03cLivePreviewDistribution.courseNotFound +
      stage03cLivePreviewDistribution.ambiguousComponent +
      stage03cLivePreviewDistribution.ambiguousInstructor +
      stage03cLivePreviewDistribution.unknownProgram +
      stage03cLivePreviewDistribution.missingDeliveryGroups ===
      stage03cLivePreviewDistribution.expandedRows,
    "anonymized fixture reproduces 131 source / 265 expanded / 0 READY distribution",
  );
  assert(stage03cLivePreviewDistribution.sourceRows === 131, "live source row count");
  assert(stage03cLivePreviewDistribution.ready === 0, "live READY count");

  const { validRows } = sourcePreviewToValidatedRows(preview);
  assert(validRows.length > 0, "valid import rows produced");
  assert(
    validRows.every((r) => r.values._delivery_group_id),
    "dg id resolved",
  );

  console.log(
    JSON.stringify({
      harness: "teaching-assignments-source-workbook-import",
      ok: true,
      matched: preview.totals.matched,
      expanded: preview.totals.expandedAssignments,
    }),
  );
}

run();
