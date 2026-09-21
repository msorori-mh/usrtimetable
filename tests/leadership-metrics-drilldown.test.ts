import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEADERSHIP_DETAIL_COLUMNS,
  LEADERSHIP_METRICS,
  LEADERSHIP_NEEDS_REVIEW,
  LEADERSHIP_UNCALCULATED,
  assignmentCoveragePercent,
  dedupePublishedSessions,
  detailCollegeOptions,
  detailHoursKey,
  filterDetailRows,
  leadershipDetailsSchema,
  quotaDeficit,
  quotaOverload,
  reconcileMetric,
  requiredAfterRelease,
  sumDetailColumn,
  uniqueFacultyCount,
} from "../src/lib/reports/leadership-metrics";

const page = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
const sheet = readFileSync("src/components/reports/leadership-metric-drilldown.tsx", "utf8");

test("المطلوب بعد الإعفاء لا ينزل تحت الصفر ويبقى غير محسوب بلا نصاب", () => {
  assert.equal(requiredAfterRelease(12, 4), 8);
  assert.equal(requiredAfterRelease(6, 10), 0);
  assert.equal(requiredAfterRelease(9, null), 9);
  assert.equal(requiredAfterRelease(null, 3), null);
});

test("النقص والزيادة لا يتداخلان ولا يصيران سالبين", () => {
  assert.equal(quotaDeficit(12, 5), 7);
  assert.equal(quotaOverload(12, 5), 0);
  assert.equal(quotaDeficit(12, 15), 0);
  assert.equal(quotaOverload(12, 15), 3);
  assert.equal(quotaDeficit(null, 15), null);
  for (const [required, assigned] of [
    [12, 5],
    [12, 15],
    [0, 0],
  ] as const) {
    const deficit = quotaDeficit(required, assigned)!;
    const overload = quotaOverload(required, assigned)!;
    assert.equal(Math.min(deficit, overload), 0, "لا يجوز أن يظهر نقص وزيادة معًا");
  }
});

test("تغطية الإسناد تُحسب على الساعات التدريسية ولا تُعرض عند نقص المصدر", () => {
  assert.equal(
    assignmentCoveragePercent({
      coveredCourseHours: 780,
      requiredCourseHours: 1560,
      sourceComplete: true,
    }),
    50,
  );
  assert.equal(
    assignmentCoveragePercent({
      coveredCourseHours: 1560,
      requiredCourseHours: 1560,
      sourceComplete: false,
    }),
    null,
    "كليات مصدر ناقصة لا تعطي 100%",
  );
  assert.equal(
    assignmentCoveragePercent({
      coveredCourseHours: 0,
      requiredCourseHours: 0,
      sourceComplete: true,
    }),
    null,
    "مقام صفري لا يعطي 0% ولا 100%",
  );
  assert.equal(
    assignmentCoveragePercent({
      coveredCourseHours: null,
      requiredCourseHours: 1560,
      sourceComplete: true,
    }),
    null,
  );
});

test("المحاضر يُحتسب مرة واحدة عبر الكليات", () => {
  assert.equal(
    uniqueFacultyCount([{ id: "a" }, { id: "a" }, { id: "b" }, { id: "b" }, { id: "c" }]),
    3,
  );
});

test("الجلسة المشتركة تُحتسب مرة واحدة والمسودات تُستبعد", () => {
  const rows = dedupePublishedSessions([
    { id: "s1", published: true },
    { id: "s1", published: true },
    { id: "s2", published: true },
    { id: "s3", published: false },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["s1", "s2"],
  );
});

test("اتساق البطاقة مع التفاصيل يعطي يحتاج مراجعة مع مقدار الفرق", () => {
  assert.deepEqual(reconcileMetric(1615, 1615), { status: "ok", difference: 0 });
  assert.deepEqual(reconcileMetric(1615, 1600), { status: "needs_review", difference: -15 });
  assert.equal(reconcileMetric(null, 1600).status, "unknown");
  assert.equal(reconcileMetric(1615, null).status, "unknown");
});

test("بحث وتصفية وإجماليات سجلات التفاصيل", () => {
  const rows = [
    { college_id: "c1", college: "تكنولوجيا المعلومات", course: "قواعد بيانات", required_hours: 4 },
    { college_id: "c1", college: "تكنولوجيا المعلومات", course: "شبكات", required_hours: 2 },
    { college_id: "c2", college: "الشريعة والقانون", course: "فقه", required_hours: 3 },
  ];
  assert.equal(filterDetailRows(rows, { collegeId: "c1" }).length, 2);
  assert.equal(filterDetailRows(rows, { search: "شبكات" }).length, 1);
  assert.equal(filterDetailRows(rows, { search: "الشريعة" })[0]?.course, "فقه");
  assert.equal(filterDetailRows(rows, {}).length, 3);
  assert.equal(sumDetailColumn(rows, "required_hours"), 9);
  assert.equal(sumDetailColumn(rows, "missing_key"), 0);
  assert.deepEqual(
    detailCollegeOptions(rows).map((item) => item.id),
    ["c2", "c1"],
  );
});

test("مخطط التفاصيل يقبل القيم الناقصة دون انهيار", () => {
  const parsed = leadershipDetailsSchema.parse({
    ok: true,
    metric: "faculty",
    year: null,
    term_type: null,
    college_id: null,
    generated_at: "2026-01-01T00:00:00Z",
    rows: [{ name: "محاضر", base_quota: null, teaching_colleges: null }],
    totals: { unique_faculty: 221, net_quota: null },
  });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.totals.net_quota, null);
});

test("كل مؤشر له تعريف ومصدر وأعمدة تفاصيل وإجمالي مطابق", () => {
  for (const [key, metric] of Object.entries(LEADERSHIP_METRICS)) {
    assert.equal(metric.id, key);
    assert.ok(metric.label.length > 2, key);
    assert.ok(metric.definition.length > 10, key);
    assert.ok(LEADERSHIP_DETAIL_COLUMNS[metric.source].length > 0, key);
    assert.ok(detailHoursKey(metric.source).length > 0, key);
  }
  assert.notEqual(
    LEADERSHIP_METRICS.covered_course_hours.label,
    LEADERSHIP_METRICS.faculty_assigned_hours.label,
    "لا يجوز توحيد المسند التدريسي مع المسند ضمن الأنصبة",
  );
});

test("صفحة الإدارة العليا تفتح كل مؤشر رئيسي إلى سجلاته", () => {
  for (const metric of [
    "faculty_count",
    "net_quota",
    "faculty_assigned_hours",
    "deficit",
    "overload",
    "required_course_hours",
    "covered_course_hours",
    "uncovered_course_hours",
    "scheduled_hours",
    "sessions_count",
    "published_colleges",
  ]) {
    assert.ok(page.includes(`"${metric}"`), `المؤشر ${metric} غير قابل للفتح`);
  }
  assert.ok(page.includes("<LeadershipMetricDrilldown"), "نافذة التفاصيل غير مركبة");
  assert.ok(page.includes("assignmentCoveragePercent("), "التغطية لا تستخدم التعريف المركزي");
  assert.ok(page.includes("openMetric(\"faculty_count\", row)"), "صف الكلية لا يفتح تفاصيله");
  assert.ok(!page.includes("فرص التحسين"), "لا توصيات ذكية في هذه المرحلة");
});

test("بطاقات الملخص الثلاث تسبق مقارنة الكليات بترتيب RTL المتفق عليه", () => {
  const instructors = page.indexOf('title="المحاضرون والأنصبة"');
  const rooms = page.indexOf('title="القاعات والمعامل"');
  const publishing = page.indexOf('title="حالة البيانات والنشر"');
  const comparison = page.indexOf('title="مقارنة الكليات"');

  assert.ok(instructors >= 0 && instructors < rooms);
  assert.ok(rooms < publishing);
  assert.ok(publishing < comparison);
  assert.ok(page.includes('className="grid gap-4 xl:grid-cols-3"'));
});

test("نافذة التفاصيل قراءة فقط وتستدعي دالة القراءة المعتمدة", () => {
  assert.ok(sheet.includes("leadership_metric_details"));
  assert.ok(sheet.includes("reconcileMetric("));
  assert.ok(sheet.includes(LEADERSHIP_NEEDS_REVIEW.slice(0, 4)) || sheet.includes("LEADERSHIP_NEEDS_REVIEW"));
  assert.ok(sheet.includes("LEADERSHIP_UNCALCULATED"));
  assert.ok(sheet.includes("downloadCSV(") && sheet.includes("downloadXLSX("));
  assert.ok(sheet.includes("onOpenChange"), "يجب إمكان إغلاق النافذة");
  for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert("]) {
    assert.ok(!sheet.includes(forbidden), `نافذة التفاصيل لا يجوز أن تكتب: ${forbidden}`);
  }
  assert.equal(LEADERSHIP_UNCALCULATED, "غير محسوب");
});
