import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleReportFilename } from "../src/lib/reports/schedule-filename";

test("an individual schedule is saved with the lecturer name alone", () => {
  assert.equal(buildScheduleReportFilename(["أ. أحمد البدوي"], "الجدول الفردي"), "أ. أحمد البدوي");
});

test("a filtered student filename identifies the program, level and study system", () => {
  assert.equal(
    buildScheduleReportFilename(["تقنية المعلومات", "المستوى الثاني", "موازي"]),
    "تقنية المعلومات — المستوى الثاني — موازي",
  );
});

test("aggregate schedules keep an explicit aggregate filename", () => {
  assert.equal(
    buildScheduleReportFilename(["جميع البرامج", "جميع المستويات", "جميع الأنظمة"]),
    "جميع البرامج — جميع المستويات — جميع الأنظمة",
  );
  assert.equal(
    buildScheduleReportFilename(["جداول الطلاب", "كلية الحاسوب", "الكلية كاملة", "جميع الأنظمة"]),
    "جداول الطلاب — كلية الحاسوب — الكلية كاملة — جميع الأنظمة",
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
    buildScheduleReportFilename([undefined, null], "  الجدول الفردي  "),
    "الجدول الفردي",
  );
  assert.equal(buildScheduleReportFilename([], ""), "جدول");
});

test("a later filter selection produces its own filename", () => {
  const first = buildScheduleReportFilename(["علوم الحاسوب", "المستوى الأول", "انتظام"]);
  const next = buildScheduleReportFilename(["نظم المعلومات", "المستوى الثالث", "موازي"]);
  assert.equal(next, "نظم المعلومات — المستوى الثالث — موازي");
  assert.notEqual(next, first);
  assert.doesNotMatch(next, /علوم الحاسوب|المستوى الأول|انتظام/);
});
