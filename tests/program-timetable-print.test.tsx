import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramTimetablePrint } from "../src/components/reports/program-timetable-print";
import type { ReportContext } from "../src/lib/reports/types";
import type { PrintSessionLike } from "../src/lib/print-center/types";
import type { ProgramReportReferences } from "../src/lib/reports/program-timetable-filters";

const references: ProgramReportReferences = {
  departments: [{ id: "dept", name: "قسم نظم المعلومات" }],
  programs: [{ id: "program", name: "نظم المعلومات الحاسوبية", department_id: "dept" }],
  levels: [{ id: "level", program_id: "program", level_number: 1, name: "المستوى الأول" }],
  cohorts: [],
};
const context: ReportContext = {
  collegeId: "college",
  termId: "term",
  versionId: "version",
  statusMode: "specific_version",
  studySystem: "regular",
  terms: [{ id: "term", name: "الفصل الأول 2026–2027" }],
  versions: [],
  selectedVersion: {
    id: "version",
    name: "مسودة الطباعة",
    status: "draft",
    academic_term_id: "term",
  },
  isLoading: false,
  error: null,
  filterSummary: "",
  setTermId() {},
  setVersionId() {},
  setStatusMode() {},
  setStudySystem() {},
};
const sessions: PrintSessionLike[] = [
  {
    id: "s1",
    college_id: "college",
    day_of_week: 0,
    start_time: "08:00",
    end_time: "10:00",
    study_system: "both",
    session_type: "lecture",
    course_offerings: {
      program_id: "program",
      level_id: "level",
      academic_programs: { name: "نظم المعلومات الحاسوبية" },
      academic_levels: { name: "المستوى الأول" },
      courses: {
        code: "IS101",
        name: "التفاضل والتكامل",
        departments: { name: "قسم آخر مالك المقرر" },
      },
    },
    instructors: { full_name: "محاضر تجريبي" },
    rooms: { code: "R1", name: "قاعة 1" },
  },
];
const render = (study: "regular" | "all" = "regular") =>
  renderToStaticMarkup(
    <ProgramTimetablePrint
      context={{ ...context, studySystem: study }}
      collegeName="كلية تكنولوجيا المعلومات وعلوم الحاسوب"
      references={references}
      sessions={sessions}
      qrUrl="https://example.test/reports/program-level-timetable?version=version&study=regular"
    />,
  );

test("report printing uses existing university identity, QR container and all academic metadata", () => {
  const html = render();
  for (const text of [
    "جامعة إقليم سبأ",
    "/branding/usr-university-logo.png",
    "رابط التحقق",
    "رابط الطباعة",
    "كلية تكنولوجيا المعلومات وعلوم الحاسوب",
    "قسم نظم المعلومات",
    "نظم المعلومات الحاسوبية",
    "المستوى الأول",
    "الفصل الأول 2026–2027",
    "مسودة الطباعة",
    "التفاضل والتكامل",
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/<section /g) ?? []).length, 1);
  // One presentation table repeats the official identity; one nested table holds sessions.
  assert.equal((html.match(/<table\b[^>]*role="presentation"/g) ?? []).length, 1);
  assert.equal((html.match(/<table\b/g) ?? []).length, 2);
  assert.equal((html.match(/<thead class="report-page-header"/g) ?? []).length, 1);
  assert.equal((html.match(/<tbody class="report-page-content"/g) ?? []).length, 1);
  const runningHeader =
    html.match(/<thead class="report-page-header">([\s\S]*?)<\/thead>/)?.[1] ?? "";
  assert.ok(runningHeader.includes("جامعة إقليم سبأ"));
  assert.ok(runningHeader.includes("/branding/usr-university-logo.png"));
  assert.ok(runningHeader.includes("رابط التحقق"));
  assert.ok(!runningHeader.includes("التفاضل والتكامل"));
  assert.ok(!html.includes("قسم آخر مالك المقرر"));
  assert.ok(!html.includes("report-timetable-grid"));
});

test("shared lectures do not create a parallel page when printing the regular system", () => {
  const html = render();
  assert.ok(html.includes("النظام العام"));
  assert.ok(!html.includes("النظام الموازي"));
  assert.equal((html.match(/التفاضل والتكامل/g) ?? []).length, 1);
});

test("all systems retain separate branded sheets and shared lectures", () => {
  const html = render("all");
  assert.equal((html.match(/<section /g) ?? []).length, 2);
  assert.equal((html.match(/التفاضل والتكامل/g) ?? []).length, 2);
  assert.equal((html.match(/<table\b[^>]*role="presentation"/g) ?? []).length, 2);
  assert.equal(sessions[0].study_system, "both");
});
