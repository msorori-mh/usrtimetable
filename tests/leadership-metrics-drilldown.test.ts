import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  LEADERSHIP_METRICS,
  assignmentCoveragePercent,
  dedupePublishedSessions,
  detailCollegeOptions,
  detailDepartmentOptions,
  filterDetailRows,
  leadershipDetailSchema,
  quotaDeficit,
  quotaOverload,
  reconcileMetric,
  requiredAfterRelease,
  sumDetailColumn,
  uniqueFacultyCount,
} from "../src/lib/reports/leadership-metrics";

const route = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
const drilldown = readFileSync("src/components/reports/leadership-metric-drilldown.tsx", "utf8");

describe("تعريفات مركزية للمؤشرات", () => {
  it("كل مؤشر له تعريف ومصدر تفاصيل", () => {
    for (const [key, definition] of Object.entries(LEADERSHIP_METRICS)) {
      expect(definition.key).toBe(key);
      expect(definition.label.length).toBeGreaterThan(2);
      expect(definition.definition.length).toBeGreaterThan(10);
      expect(["faculty", "teaching", "schedules"]).toContain(definition.source);
    }
  });

  it("يميّز الساعات المسندة للمقررات عن المسندة ضمن الأنصبة", () => {
    expect(LEADERSHIP_METRICS.assignment_coverage.label).toContain("مقررات");
    expect(LEADERSHIP_METRICS.faculty_assigned_hours.label).toContain("أنصبة");
  });

  it("نقص الأنصبة لا يتداخل مع ساعات التدريس غير المسندة", () => {
    expect(LEADERSHIP_METRICS.quota_deficit_hours.source).toBe("faculty");
    expect(LEADERSHIP_METRICS.uncovered_hours.source).toBe("teaching");
    expect(LEADERSHIP_METRICS.quota_deficit_hours.detailColumn).toBe("deficit_hours");
    expect(LEADERSHIP_METRICS.uncovered_hours.detailColumn).toBe("uncovered_hours");
  });

  it("المجدول يُقرأ من النسخ المنشورة والإسناد من مكونات التدريس", () => {
    expect(LEADERSHIP_METRICS.scheduled_hours.source).toBe("schedules");
    expect(LEADERSHIP_METRICS.assignment_coverage.source).toBe("teaching");
  });
});

describe("المعادلات", () => {
  it("المطلوب بعد الإعفاء", () => {
    expect(requiredAfterRelease(18, 4)).toBe(14);
    expect(requiredAfterRelease(10, 20)).toBe(0);
    expect(requiredAfterRelease(null, 4)).toBeNull();
  });

  it("نقص النصاب والزيادة", () => {
    expect(quotaDeficit(14, 9)).toBe(5);
    expect(quotaDeficit(14, 20)).toBe(0);
    expect(quotaOverload(14, 20)).toBe(6);
    expect(quotaOverload(null, 20)).toBeNull();
  });

  it("لا تُعرض نسبة تغطية عند نقص المصدر", () => {
    expect(assignmentCoveragePercent({ required: 1615, covered: 1560 })).toBe(96.6);
    expect(assignmentCoveragePercent({ required: 0, covered: 0 })).toBeNull();
    expect(assignmentCoveragePercent({ required: null, covered: 10 })).toBeNull();
    expect(
      assignmentCoveragePercent({ required: 1615, covered: 1560, incompleteColleges: 2 }),
    ).toBeNull();
  });

  it("عدد المحاضرين = الهويات الفريدة", () => {
    const rows = [
      { identity_id: "a", college: "تكنولوجيا" },
      { identity_id: "a", college: "الشريعة" },
      { identity_id: "b", college: "الشريعة" },
      { identity_id: null },
    ];
    expect(uniqueFacultyCount(rows)).toBe(2);
  });

  it("لا تتكرر الجلسة المشتركة ولا تُحسب المسودات", () => {
    const rows = [
      { session_id: "s1", published: true },
      { session_id: "s1", published: true },
      { session_id: "s2", published: false },
    ];
    expect(dedupePublishedSessions(rows)).toHaveLength(1);
  });
});

describe("تحقق الاتساق", () => {
  it("يتطابق مجموع التفاصيل مع رقم البطاقة", () => {
    expect(reconcileMetric(826, 826).status).toBe("ok");
  });

  it("يعرض يحتاج مراجعة مع مقدار الفرق", () => {
    const check = reconcileMetric(826, 800);
    expect(check.status).toBe("needs_review");
    expect(check.status === "needs_review" ? check.difference : null).toBe(-26);
  });

  it("القيم الناقصة تعطي يحتاج مراجعة بلا رقم مضلل", () => {
    expect(reconcileMetric(null, 10).status).toBe("needs_review");
    expect(reconcileMetric(10, null).status).toBe("needs_review");
  });
});

describe("سجلات التفاصيل", () => {
  const rows = [
    { college: "تكنولوجيا", department: "حاسوب", name: "أ. سارة", required_hours: 12 },
    { college: "الشريعة", department: "فقه", name: "د. تيهان", required_hours: 8 },
    { college: "الشريعة", department: null, name: "د. الجحدبي", required_hours: null },
  ];

  it("البحث والتصفية", () => {
    expect(filterDetailRows(rows, { search: "تيهان" })).toHaveLength(1);
    expect(filterDetailRows(rows, { college: "الشريعة" })).toHaveLength(2);
    expect(filterDetailRows(rows, { department: "حاسوب" })).toHaveLength(1);
    expect(filterDetailRows(rows, {})).toHaveLength(3);
  });

  it("المجاميع وخيارات التصفية تتجاهل القيم الناقصة", () => {
    expect(sumDetailColumn(rows, "required_hours")).toBe(20);
    expect(sumDetailColumn([], "required_hours")).toBe(0);
    expect(detailCollegeOptions(rows)).toHaveLength(2);
    expect(detailDepartmentOptions(rows)).toHaveLength(2);
  });

  it("مخطط الاستجابة يتحمل الحقول الناقصة", () => {
    const parsed = leadershipDetailSchema.parse({ metric: "faculty", rows: [], totals: {} });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.ok).toBe(true);
  });
});

describe("توصيل الصفحة", () => {
  it("كل بطاقة رئيسية قابلة للفتح إلى سجلاتها", () => {
    for (const key of [
      "faculty_count",
      "assignment_coverage",
      "required_after_release",
      "overload_hours",
      "quota_deficit_hours",
      "published_versions",
    ]) {
      expect(route).toContain(`openMetric("${key}"`);
    }
    expect(route).toContain("LeadershipMetricDrilldown");
  });

  it("الصفحة تستخدم التعريفات المركزية ولا تعرض نسبة غير مكتملة", () => {
    expect(route).toContain("LEADERSHIP_METRICS.quota_deficit_hours.definition");
    expect(route).toContain("assignmentCoveragePercent");
    expect(route).not.toContain("universityCoverage");
  });

  it("صف البطاقات الثلاث يظهر قبل مقارنة الكليات بترتيب RTL", () => {
    const grid = route.indexOf('<div className="grid gap-4 xl:grid-cols-3">');
    const compare = route.indexOf('title="مقارنة الكليات"');
    expect(grid).toBeGreaterThan(-1);
    expect(grid).toBeLessThan(compare);
    const faculty = route.indexOf('title="المحاضرون والأنصبة"');
    const roomsIdx = route.indexOf('title="القاعات والمعامل"');
    const status = route.indexOf('title="حالة البيانات والنشر"');
    expect(faculty).toBeLessThan(roomsIdx);
    expect(roomsIdx).toBeLessThan(status);
    expect(status).toBeLessThan(compare);
  });

  it("نافذة التفاصيل تقرأ فقط وتوفر التصدير والحالة الفارغة", () => {
    expect(drilldown).toContain("leadership_metric_details");
    expect(drilldown).toContain("downloadCSV");
    expect(drilldown).toContain("downloadXLSX");
    expect(drilldown).toContain("لا توجد سجلات مطابقة");
    expect(drilldown).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
