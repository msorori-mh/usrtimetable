import { describe, expect, it } from "bun:test";
import {
  QUOTA_UNDEFINED_AR,
  computeQuotaBalance,
  resolveInstructorQuota,
  summarizeQuotaBalances,
} from "../src/lib/reports/instructor-quota";
import {
  DEFAULT_DIRECTORY_FILTERS,
  filterAndSortInstructors,
  hasActiveDirectoryFilters,
  matchesInstructorSearch,
  type DirectoryInstructor,
} from "../src/lib/instructors/directory-filters";
import {
  ACADEMIC_REPORT_HEADERS,
  buildAcademicReport,
  isMissingQuotaRow,
  summarizeWorkloadRows,
} from "../src/lib/reports/academic-affairs";

describe("approved quota resolution", () => {
  it("prefers the saved instructor quota over the rank policy", () => {
    const q = resolveInstructorQuota({ policyRequiredHours: 12, maxWeeklyHours: 18 });
    expect(q.baseHours).toBe(18);
    expect(q.source).toBe("instructor");
  });

  it("falls back to the member's own approved weekly load when no policy exists", () => {
    const q = resolveInstructorQuota({ policyRequiredHours: null, maxWeeklyHours: 16 });
    expect(q.baseHours).toBe(16);
    expect(q.netHours).toBe(16);
    expect(q.source).toBe("instructor");
  });

  it("treats a numeric zero as a real approved quota, not as missing", () => {
    const q = resolveInstructorQuota({ policyRequiredHours: 12, maxWeeklyHours: 0 });
    expect(q.baseHours).toBe(0);
    expect(q.source).toBe("instructor");
    expect(q.netHours).toBe(0);
  });

  it("reports missing quota when neither source has a number", () => {
    const q = resolveInstructorQuota({ policyRequiredHours: null, maxWeeklyHours: null });
    expect(q.baseHours).toBeNull();
    expect(q.netHours).toBeNull();
    expect(q.source).toBe("missing");
  });

  it("uses the administrative quota as the net quota when present", () => {
    const b = computeQuotaBalance({ maxWeeklyHours: 18, adminReleaseHours: 6, assignedHours: 12 });
    expect(b.releaseHours).toBe(6);
    expect(b.netHours).toBe(6);
    expect(b.overloadHours).toBe(6);
    expect(b.deficitHours).toBe(0);
    expect(b.status).toBe("overload");
  });

  it("keeps base 12, administrative quota 3, and computes 7 extra hours from 10 assigned", () => {
    const b = computeQuotaBalance({ maxWeeklyHours: 12, adminReleaseHours: 3, assignedHours: 10 });
    expect(b.baseHours).toBe(12);
    expect(b.releaseHours).toBe(3);
    expect(b.netHours).toBe(3);
    expect(b.overloadHours).toBe(7);
    expect(b.deficitHours).toBe(0);
    expect(b.status).toBe("overload");
  });

  it("computes overload and deficit against the net quota", () => {
    const over = computeQuotaBalance({ maxWeeklyHours: 12, assignedHours: 18 });
    expect(over.overloadHours).toBe(6);
    expect(over.deficitHours).toBe(0);
    expect(over.status).toBe("overload");
    const under = computeQuotaBalance({ maxWeeklyHours: 12, assignedHours: 4.5 });
    expect(under.deficitHours).toBe(7.5);
    expect(under.status).toBe("deficit");
  });

  it("never derives overload or deficit without an approved quota", () => {
    const b = computeQuotaBalance({ maxWeeklyHours: null, assignedHours: 9 });
    expect(b.overloadHours).toBeNull();
    expect(b.deficitHours).toBeNull();
    expect(b.status).toBe("missing");
  });

  it("excludes members without a quota from totals and counts them separately", () => {
    const totals = summarizeQuotaBalances([
      computeQuotaBalance({ maxWeeklyHours: 10, assignedHours: 14 }),
      computeQuotaBalance({ maxWeeklyHours: 10, assignedHours: 4 }),
      computeQuotaBalance({ maxWeeklyHours: null, assignedHours: 20 }),
    ]);
    expect(totals.countedMembers).toBe(2);
    expect(totals.missingMembers).toBe(1);
    expect(totals.netQuotaHours).toBe(20);
    expect(totals.assignedHours).toBe(18);
    expect(totals.overloadHours).toBe(4);
    expect(totals.deficitHours).toBe(6);
  });
});

const scope = {
  collegeId: "c1",
  termId: "t1",
  departmentId: "all",
  programId: "all",
  instructorId: "all",
};

function workloadRows(
  instructors: Parameters<typeof buildAcademicReport>[0]["instructors"],
  workloads: Parameters<typeof buildAcademicReport>[0]["workloads"],
) {
  return buildAcademicReport(
    { scope, instructors, programs: [], departments: [], groups: [], workloads },
    "workload",
  );
}

describe("workload report rows", () => {
  const instructors = [
    {
      id: "i1",
      full_name: "أ. سارة",
      academic_rank: "أستاذ مساعد",
      department_id: null,
      max_weekly_hours: 18,
      administrative_release_hours: 6,
    },
    {
      id: "i2",
      full_name: "أ. خالد",
      academic_rank: null,
      department_id: null,
      max_weekly_hours: null,
      administrative_release_hours: 0,
    },
  ];
  const workloads = [
    {
      instructor_id: "i1",
      required_load_hours: null,
      standard_assigned_hours: 15,
      project_supervision_hours: 2,
    },
    {
      instructor_id: "i2",
      required_load_hours: null,
      standard_assigned_hours: 9,
      project_supervision_hours: 0,
    },
  ];

  it("shows the approved quota from the member card when no rank policy exists", () => {
    const [row] = workloadRows(instructors, workloads);
    expect(row.base_required).toBe(18);
    expect(row.release).toBe(6);
    expect(row.required).toBe(6);
    expect(row.assigned).toBe(15);
    expect(row.overload).toBe(9);
    expect(row.deficit).toBe(0);
    expect(row.quota_source).toBe("بطاقة عضو هيئة التدريس");
  });

  it("shows «غير محدد» and no overload/deficit when there is no approved quota", () => {
    const row = workloadRows(instructors, workloads)[1]!;
    expect(row.required).toBe(QUOTA_UNDEFINED_AR);
    expect(row.overload).toBe(QUOTA_UNDEFINED_AR);
    expect(row.deficit).toBe(QUOTA_UNDEFINED_AR);
    expect(isMissingQuotaRow(row)).toBe(true);
  });

  it("keeps totals consistent with the exact displayed/exported rows", () => {
    const rows = workloadRows(instructors, workloads);
    const totals = summarizeWorkloadRows(rows);
    expect(totals.missingMembers).toBe(1);
    expect(totals.netQuotaHours).toBe(6);
    expect(totals.overloadHours).toBe(9);
    // export headers cover every computed column
    const keys = ACADEMIC_REPORT_HEADERS.workload.map((h) => h.key);
    for (const key of [
      "base_required",
      "release",
      "required",
      "overload",
      "deficit",
      "quota_source",
    ])
      expect(keys).toContain(key);
    for (const row of rows) for (const key of keys) expect(key in row).toBe(true);
  });
});

describe("instructor directory search, filters and sorting", () => {
  const rows: DirectoryInstructor[] = [
    {
      id: "1",
      full_name: "أحمد علي",
      full_name_ar: "أحمد علي",
      employee_number: "1002",
      email: "ahmed@usr.edu.ye",
      department_id: "d1",
      academic_rank: "أستاذ",
      instructor_type_id: "t1",
      is_active: true,
      max_weekly_hours: 12,
    },
    {
      id: "2",
      full_name: "Sara Ahmad",
      full_name_en: "Sara Ahmad",
      employee_number: "1001",
      email: "sara@usr.edu.ye",
      department_id: "d2",
      academic_rank: "محاضر",
      instructor_type_id: null,
      is_active: false,
      max_weekly_hours: 18,
    },
    {
      id: "3",
      full_name: "منى سعيد",
      full_name_ar: "مُنى سعيد",
      employee_number: null,
      email: null,
      department_id: null,
      academic_rank: "أستاذ",
      instructor_type_id: "t1",
      is_active: true,
      max_weekly_hours: null,
    },
  ];
  const deptName = (id: string | null | undefined) =>
    id === "d1" ? "تقنية المعلومات" : id === "d2" ? "الشبكات" : "بدون قسم";
  const f = (over: Partial<typeof DEFAULT_DIRECTORY_FILTERS>) => ({
    ...DEFAULT_DIRECTORY_FILTERS,
    ...over,
  });

  it("normalizes Arabic search text (hamza, diacritics, ta marbuta)", () => {
    expect(matchesInstructorSearch(rows[2]!, "منى")).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "احمد")).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "أحمد")).toBe(true);
  });

  it("searches English names, employee number, email and department", () => {
    expect(matchesInstructorSearch(rows[1]!, "sara")).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "1002")).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "ahmed@usr")).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "تقنية", deptName("d1"))).toBe(true);
    expect(matchesInstructorSearch(rows[0]!, "الشبكات", deptName("d1"))).toBe(false);
  });

  it("combines search with filters", () => {
    const result = filterAndSortInstructors(
      rows,
      f({ search: "احمد", status: "active" }),
      deptName,
    );
    expect(result.map((r) => r.id)).toEqual(["1"]);
    expect(
      filterAndSortInstructors(rows, f({ rank: "أستاذ", departmentId: "none" }), deptName).map(
        (r) => r.id,
      ),
    ).toEqual(["3"]);
    expect(
      filterAndSortInstructors(rows, f({ typeId: "none" }), deptName).map((r) => r.id),
    ).toEqual(["2"]);
    expect(
      filterAndSortInstructors(rows, f({ status: "inactive" }), deptName).map((r) => r.id),
    ).toEqual(["2"]);
  });

  it("sorts stably by employee number and by approved quota", () => {
    expect(
      filterAndSortInstructors(rows, f({ sortKey: "employee_number" }), deptName).map(
        (r) => r.employee_number,
      ),
    ).toEqual(["1001", "1002", null]);
    expect(
      filterAndSortInstructors(rows, f({ sortKey: "quota" }), deptName).map(
        (r) => r.max_weekly_hours,
      ),
    ).toEqual([12, 18, null]);
    expect(
      filterAndSortInstructors(rows, f({ sortKey: "quota", sortDirection: "desc" }), deptName).map(
        (r) => r.max_weekly_hours,
      ),
    ).toEqual([18, 12, null]);
    // ties keep the incoming order
    const tied = [
      { id: "a", full_name: "سالم", max_weekly_hours: 10 },
      { id: "b", full_name: "سالم", max_weekly_hours: 10 },
    ];
    expect(
      filterAndSortInstructors(tied, f({ sortKey: "quota" }), deptName).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("knows when filters are active so the clear action can appear", () => {
    expect(hasActiveDirectoryFilters(DEFAULT_DIRECTORY_FILTERS)).toBe(false);
    expect(hasActiveDirectoryFilters(f({ search: "a" }))).toBe(true);
    expect(hasActiveDirectoryFilters(f({ sortKey: "quota" }))).toBe(false);
  });
});

describe("approved workload report contract", () => {
  function row(assigned: number) {
    return workloadRows(
      [
        {
          id: "i",
          full_name: "Test",
          academic_rank: "أستاذ مساعد",
          department_id: null,
          administrative_position: "department_head",
          max_weekly_hours: 18,
          administrative_release_hours: 6,
        },
      ],
      [
        {
          instructor_id: "i",
          required_load_hours: 12,
          standard_assigned_hours: assigned,
          project_supervision_hours: 0,
        },
      ],
    )[0]!;
  }
  it("uses the saved base and the administrative quota once even when RPC returns net hours", () => {
    const r = row(18);
    expect(r.base_required).toBe(18);
    expect(r.required).toBe(6);
    expect(r.administrative_position).toBe("رئيس قسم");
    expect(r.overload).toBe(12);
    expect(r.status).toBe("ساعات زائدة");
  });
  it("distinguishes above 12 extra hours from permitted extra hours", () => {
    expect(row(18.5).status).toBe("تجاوز الحد المسموح للساعات الزائدة");
    expect(row(6).overload).toBe(0);
  });
  it("exports every requested field without remaining allowance", () => {
    const headers = ACADEMIC_REPORT_HEADERS.workload;
    for (const label of [
      "الرتبة العلمية",
      "المنصب الإداري",
      "النصاب الأساسي",
      "الإعفاء الإداري",
      "النصاب الفعلي",
      "الساعات المسندة",
      "الساعات الزائدة",
    ]) {
      expect(headers.some((h) => h.label === label)).toBe(true);
    }
    expect(headers.some((h) => h.label.includes("المتبقي"))).toBe(false);
  });
});
