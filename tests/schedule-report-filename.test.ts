import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleReportFilename } from "../src/lib/reports/schedule-filename";

test("Arabic schedule and lecturer names remain readable in the saved filename", () => {
  assert.equal(
    buildScheduleReportFilename([
      "الفصل الأول 2026",
      "الجدول الفردي",
      "أحمد البدوي",
      "جميع الكليات",
    ]),
    "الفصل الأول 2026 — الجدول الفردي — أحمد البدوي — جميع الكليات",
  );
});

test("a filtered student filename identifies the program, level and study system", () => {
  assert.equal(
    buildScheduleReportFilename([
      "الجدول المعتمد",
      "جداول الطلاب",
      "كلية تكنولوجيا المعلومات",
      "علوم الحاسوب",
      "المستوى الثاني",
      "موازي",
    ]),
    "الجدول المعتمد — جداول الطلاب — كلية تكنولوجيا المعلومات — علوم الحاسوب — المستوى الثاني — موازي",
  );
});

test("unsafe filename characters and whitespace are normalized without losing Arabic", () => {
  const name = buildScheduleReportFilename([
    "  نسخة / 2026:2027  ",
    "  جدول\n الطلاب  ",
    'المستوى "الثاني" <عام> * ? | \\',
  ]);
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
  assert.doesNotMatch(name, /\s{2,}/);
  assert.match(name, /نسخة/);
  assert.match(name, /2026/);
  assert.match(name, /جدول الطلاب/);
  assert.match(name, /الثاني/);
});

test("missing optional labels use the human report fallback rather than inventing identifiers", () => {
  assert.equal(
    buildScheduleReportFilename([null, undefined, "", "  "], "جداول الطلاب"),
    "جداول الطلاب",
  );
  assert.equal(
    buildScheduleReportFilename([undefined, "  الجدول الفردي  ", null]),
    "الجدول الفردي",
  );
  assert.equal(buildScheduleReportFilename([], ""), "جدول");
});

test("a later schedule or filter selection produces its own filename", () => {
  const first = buildScheduleReportFilename(["النسخة الأولى", "علوم الحاسوب", "المستوى الأول"]);
  const next = buildScheduleReportFilename(["النسخة الثانية", "نظم المعلومات", "المستوى الثالث"]);
  assert.equal(next, "النسخة الثانية — نظم المعلومات — المستوى الثالث");
  assert.notEqual(next, first);
  assert.doesNotMatch(next, /النسخة الأولى|علوم الحاسوب|المستوى الأول/);
});
