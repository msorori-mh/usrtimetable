import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStudyPlansPrint,
  type PrintablePlan,
  type PrintableCourse,
} from "../src/lib/study-plans/print.ts";
const plan: PrintablePlan = {
  id: "p",
  name: "خطة العلوم",
  code: "SCI",
  version: "2",
  effective_year: 2026,
  is_active: true,
  programName: "علوم",
  departmentName: "تربية",
};
const course = (id: string, level: number, semester: number): PrintableCourse => ({
  id,
  semester,
  is_required: true,
  course: { code: id, name: id, credit_hours: null },
  level: { name: `مستوى ${level}`, level_number: level },
  components: [],
});
test("orders levels numerically then semesters without mutating the input", () => {
  const courses = [course("LAST", 10, 1), course("SECOND", 2, 2), course("FIRST", 2, 1)];
  const html = buildStudyPlansPrint("التربية", [{ plan, courses }]);
  assert.ok(html.indexOf("FIRST") < html.indexOf("SECOND"));
  assert.ok(html.indexOf("SECOND") < html.indexOf("LAST"));
  assert.equal(courses[0].id, "LAST");
});
test("escapes stored content and preserves unknown credit hours and components", () => {
  const c = course("C", 1, 1);
  c.course!.name = "<script>alert(1)</script>";
  c.components = [{ component_type: "project", weekly_contact_hours: 2 }];
  const html = buildStudyPlansPrint("كلية <img>", [{ plan, courses: [c] }]);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("مشروع: 2"));
  assert.ok(html.includes("<td>—</td>"));
});
test("keeps empty plans visible and each plan separate, with scope and version", () => {
  const html = buildStudyPlansPrint("الكلية", [
    { plan, courses: [] },
    { plan: { ...plan, id: "p2", is_active: false }, courses: [] },
  ]);
  assert.equal((html.match(/<section>/g) || []).length, 2);
  assert.ok(html.includes("لا توجد مقررات مسجلة"));
  assert.ok(html.includes("غير سارية"));
  assert.ok(html.includes("القسم: تربية"));
  assert.ok(html.includes("الإصدار: 2"));
});
