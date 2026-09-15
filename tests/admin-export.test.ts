/**
 * ADMIN-EXPORT-01 — unified admin export: formatting, metadata, filenames,
 * filter fidelity, and "all matching rows, not just the current page".
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import {
  ADMIN_EXPORT_CRITERIA_SHEET_AR,
  ADMIN_EXPORT_EMPTY_AR,
  ADMIN_EXPORT_LIMIT_AR,
  ADMIN_EXPORT_ROW_LIMIT,
  adminExportFilename,
  buildAdminExportCsv,
  buildAdminExportMetadata,
  buildAdminExportTable,
  formatAdminExportValue,
} from "@/lib/admin-export/dataset";
import { buildAdminExportWorkbook } from "@/lib/admin-export/download";
import {
  activeFilters,
  cohortsExportDataset,
  deliveryGroupsExportDataset,
  headcountsExportDataset,
  instructorsExportDataset,
  roomsExportDataset,
  teachingAssignmentsExportDataset,
  type CohortExportRow,
  type RoomExportRow,
} from "@/lib/admin-export/datasets";
import { buildPlanContentRows } from "@/lib/admin-export/plan-content-rows";
import {
  COHORT_PAGE_SIZE,
  cohortDirectoryPage,
  filterCohortDirectory,
  type CohortListRow,
} from "@/lib/academic-delivery/cohort-directory";

const NOW = new Date(2026, 8, 12, 9, 5);

const rooms: RoomExportRow[] = [
  {
    code: "A-101",
    name: "قاعة 1",
    room_type: "lecture_hall",
    capacity: 75,
    building: "المبنى الرئيسي",
    floor: "1",
    is_active: true,
    notes: null,
  },
  {
    code: "L-201",
    name: "معمل حاسوب",
    room_type: "computer_lab",
    capacity: 38,
    building: null,
    floor: null,
    is_active: false,
    notes: 'ملاحظة, تحتوي "فاصلة"',
  },
];

function roomsDataset(filters = [{ label: "النوع", value: "قاعة محاضرات" }]) {
  return roomsExportDataset({
    rows: rooms,
    collegeName: "كلية الحاسوب",
    roomTypeLabel: (v) => (v === "lecture_hall" ? "قاعة محاضرات" : "معمل حاسوب"),
    filters,
  });
}

describe("value formatting", () => {
  test("booleans, blanks and numbers become readable Arabic cells", () => {
    expect(formatAdminExportValue(true)).toBe("نعم");
    expect(formatAdminExportValue(false)).toBe("لا");
    expect(formatAdminExportValue(null)).toBe("—");
    expect(formatAdminExportValue("  ")).toBe("—");
    expect(formatAdminExportValue(38)).toBe(38);
  });
});

describe("table + filenames", () => {
  test("headers and rows follow declared column order", () => {
    const table = buildAdminExportTable(roomsDataset());
    expect(table.headers).toEqual([
      "الرمز",
      "الاسم",
      "النوع",
      "السعة",
      "المبنى",
      "الطابق",
      "مفعّلة",
      "ملاحظات",
    ]);
    expect(table.rowCount).toBe(2);
    expect(table.body[0]).toEqual([
      "A-101",
      "قاعة 1",
      "قاعة محاضرات",
      75,
      "المبنى الرئيسي",
      "1",
      "نعم",
      "—",
    ]);
    expect(table.body[1]?.[6]).toBe("لا");
  });

  test("filename is descriptive, ASCII-safe and timestamped", () => {
    expect(adminExportFilename("teaching-assignments", NOW)).toBe(
      "teaching-assignments-20260912-0905",
    );
    expect(adminExportFilename("محتويات الخطة", NOW)).toBe("export-20260912-0905");
  });

  test("empty and oversized datasets fail with actionable Arabic messages", () => {
    expect(() =>
      buildAdminExportTable(roomsExportDataset({ rows: [], roomTypeLabel: (v) => v ?? "" })),
    ).toThrow(ADMIN_EXPORT_EMPTY_AR);
    const huge = roomsExportDataset({
      rows: new Array(ADMIN_EXPORT_ROW_LIMIT + 1).fill(rooms[0]!),
      roomTypeLabel: (v) => v ?? "",
    });
    expect(() => buildAdminExportTable(huge)).toThrow(ADMIN_EXPORT_LIMIT_AR);
  });
});

describe("criteria metadata", () => {
  test("records report, college, row count and the applied filters", () => {
    const meta = buildAdminExportMetadata(roomsDataset(), NOW);
    const flat = meta.map((r) => r.join("="));
    expect(flat).toContain("التقرير=القاعات والمعامل");
    expect(flat).toContain("الكلية=كلية الحاسوب");
    expect(flat).toContain("عدد السجلات المصدَّرة=2");
    expect(flat).toContain("النوع=قاعة محاضرات");
  });

  test("no filters is stated explicitly", () => {
    const meta = buildAdminExportMetadata(roomsDataset([]), NOW);
    expect(meta.some((r) => String(r[0]).startsWith("بدون فلاتر"))).toBe(true);
  });

  test("activeFilters drops empty and default selections", () => {
    expect(
      activeFilters([
        { label: "القسم", value: "" },
        { label: "البرنامج", value: "الكل" },
        { label: "الفصل", value: "الفصل الأول" },
        { label: "الحالة", value: "نشطة", isDefault: true },
      ]),
    ).toEqual([{ label: "الفصل", value: "الفصل الأول" }]);
  });
});

describe("CSV output", () => {
  const csv = buildAdminExportCsv(roomsDataset(), NOW);

  test("starts with a UTF-8 BOM so Excel reads Arabic correctly", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  test("header row, quoted values and the criteria block are present", () => {
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    expect(lines[0]).toBe("الرمز,الاسم,النوع,السعة,المبنى,الطابق,مفعّلة,ملاحظات");
    expect(lines[1]?.startsWith("A-101,")).toBe(true);
    expect(lines[2]).toContain('"ملاحظة, تحتوي ""فاصلة"""');
    expect(csv).toContain("عدد السجلات المصدَّرة,2");
  });
});

describe("XLSX workbook", () => {
  test("has a data sheet and a filter-criteria sheet with every row", () => {
    const wb = buildAdminExportWorkbook(roomsDataset(), NOW);
    expect(wb.SheetNames).toEqual(["القاعات", ADMIN_EXPORT_CRITERIA_SHEET_AR]);
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["القاعات"]!);
    expect(data).toHaveLength(2);
    expect(data[0]?.["الرمز"]).toBe("A-101");
    const meta = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[ADMIN_EXPORT_CRITERIA_SHEET_AR]!, {
      header: 1,
    });
    expect(meta.flat()).toContain("النوع");
  });
});

describe("exports cover all matching rows, not the visible page", () => {
  const cohorts: CohortListRow[] = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    code: `COH-${i}`,
    program_id: i % 2 === 0 ? "p1" : "p2",
    level_id: "l1",
    term_id: "t1",
    study_system: "regular",
    entry_year: 2026,
    expected_students: 30 + i,
    count_status: "confirmed",
    active: true,
    programName: i % 2 === 0 ? "برنامج أ" : "برنامج ب",
    levelName: "المستوى الأول",
    levelNumber: 1,
    termName: "الفصل الأول",
  }));

  test("cohort export row count equals the filtered set, larger than one page", () => {
    const filtered = filterCohortDirectory(cohorts, {
      search: "",
      program: "p1",
      level: "all",
      system: "all",
      term: "all",
      activity: "all",
    });
    const page = cohortDirectoryPage(filtered, 1);
    expect(filtered).toHaveLength(10);
    expect(page.rows.length).toBe(COHORT_PAGE_SIZE);

    const dataset = cohortsExportDataset({
      rows: filtered as CohortExportRow[],
      collegeName: "كلية الحاسوب",
      systemLabel: () => "نظامي",
      countStatusLabel: () => "مؤكد",
      filters: activeFilters([{ label: "البرنامج", value: "برنامج أ" }]),
    });
    const table = buildAdminExportTable(dataset);
    expect(table.rowCount).toBe(filtered.length);
    expect(table.rowCount).toBeGreaterThan(page.rows.length);
    expect(table.body.every((row) => row[1] === "برنامج أ")).toBe(true);
    expect(buildAdminExportMetadata(dataset, NOW).map((r) => r.join("="))).toContain(
      "البرنامج=برنامج أ",
    );
  });
});

describe("teaching assignments export", () => {
  test("joins instructor names, hours and status labels", () => {
    const dataset = teachingAssignmentsExportDataset({
      rows: [
        {
          course_code: "USR07",
          course_name: "مشروع",
          component_type: "project",
          group_number: 1,
          group_code: "G1",
          cohort_code: "COH-1",
          expected_students: 40,
          capacity_limit: 75,
          component_hours: 2,
          assigned_hours_total: 2,
          remaining_hours: 0,
          allocation_status: "fully_allocated",
          active: true,
          is_obsolete: false,
          instructors: [{ instructor_name: "أحمد" }, { instructor_name: "سالم" }],
        },
      ],
      collegeName: "كلية الحاسوب",
      componentLabel: (v) => (v === "project" ? "مشروع" : (v ?? "")),
      allocationLabel: (v) => (v === "fully_allocated" ? "مكتمل" : (v ?? "")),
      filters: activeFilters([{ label: "نوع المحاضرة", value: "مشروع" }]),
    });
    const table = buildAdminExportTable(dataset);
    expect(table.headers).toContain("المحاضرون");
    expect(table.body[0]).toContain("أحمد، سالم");
    expect(table.body[0]).toContain("مكتمل");
    expect(table.body[0]).toContain("نشطة");
    expect(dataset.fileBase).toBe("teaching-assignments");
  });
});

describe("plan contents export", () => {
  test("one row per component, and a row for a course with no components", () => {
    const rows = buildPlanContentRows({
      planCourses: [
        {
          id: "pc1",
          course_id: "c1",
          level_id: "l1",
          semester: 1,
          is_required: true,
          lectures_per_week: 1,
          lecture_session_duration: 2,
          labs_per_week: 1,
          lab_session_duration: 2,
        },
        { id: "pc2", course_id: "c2", level_id: null, semester: 2, is_required: false },
      ],
      components: [
        {
          plan_course_id: "pc1",
          component_type: "theory",
          weekly_contact_hours: 2,
          required_room_type_id: "rt1",
          is_timetabled: true,
          counts_toward_regular_load: true,
          counts_toward_overtime: true,
          compensation_mode: "per_hour",
          explicit_group_size: null,
        },
        {
          plan_course_id: "pc1",
          component_type: "practical",
          weekly_contact_hours: 2,
          required_room_type_id: null,
          is_timetabled: true,
          counts_toward_regular_load: true,
          counts_toward_overtime: true,
          compensation_mode: "per_hour",
          explicit_group_size: 38,
        },
      ],
      courseLabel: (id) =>
        id === "c1" ? { code: "CS111", name: "مشروع" } : { code: "CS112", name: "شبكات" },
      levelLabel: (id) => (id ? "المستوى الأول" : null),
      roomTypeLabel: (id) => (id ? "قاعة محاضرات" : null),
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.component_type).toBe("theory");
    expect(rows[1]?.explicit_group_size).toBe(38);
    expect(rows[2]?.component_type).toBeNull();
    expect(rows[2]?.course_code).toBe("CS112");
  });
});

describe("other admin lists produce usable columns", () => {
  test("instructors export labels departments, categories and employment", () => {
    const table = buildAdminExportTable(
      instructorsExportDataset({
        rows: [
          {
            employee_number: "1001",
            full_name: "أحمد",
            full_name_en: "Ahmed",
            department_id: "d1",
            academic_rank: "مدرس",
            employment_type: null,
            max_weekly_hours: 18,
            administrative_release_hours: 6,
            instructor_type_id: null,
            is_active: true,
            needs_review: true,
          },
          {
            employee_number: "1002",
            full_name: "سالم",
            full_name_en: null,
            department_id: null,
            academic_rank: null,
            employment_type: null,
            max_weekly_hours: null,
            instructor_type_id: null,
            is_active: true,
            needs_review: false,
          },
        ],
        departmentLabel: () => "قسم الحاسوب",
        categoryLabel: () => "محاضر دائم",
        employmentLabel: () => "غير محدد (لم يُثبت بعد)",
      }),
    );
    expect(table.headers).toEqual([
      "الرقم الوظيفي",
      "الاسم",
      "الاسم بالإنجليزية",
      "القسم",
      "الرتبة العلمية",
      "نوع التعاقد",
      "النصاب الأساسي الأسبوعي",
      "ساعات الإعفاء الإداري",
      "النصاب الفعلي",
      "الفئة",
      "مفعّل",
      "يحتاج مراجعة",
    ]);
    const base = table.headers.indexOf("النصاب الأساسي الأسبوعي");
    const release = table.headers.indexOf("ساعات الإعفاء الإداري");
    const net = table.headers.indexOf("النصاب الفعلي");
    // net = base − administrative release, floored at 0
    expect(table.body[0]?.[base]).toBe(18);
    expect(table.body[0]?.[release]).toBe(6);
    expect(table.body[0]?.[net]).toBe(12);
    // a missing base quota stays «—», never 0, and never invents a net value
    expect(table.body[1]?.[base]).toBe("—");
    expect(table.body[1]?.[release]).toBe(0);
    expect(table.body[1]?.[net]).toBe("—");
    expect(table.body[0]).toContain("غير محدد (لم يُثبت بعد)");
    expect(table.body[0]?.at(-1)).toBe("نعم");

  });

  test("headcounts and delivery groups datasets expose the scheduling numbers", () => {
    const hc = buildAdminExportTable(
      headcountsExportDataset({
        rows: [
          {
            cohort_id: "c1",
            term_id: "t1",
            study_system: "regular",
            registered_student_count: 50,
            eligible_student_count: 48,
            expected_attendance_count: 45,
            reserve_margin: 2,
            scheduling_headcount: 47,
            exam_eligible_count: 48,
            approval_status: "approved",
            source: "import",
            notes: null,
            approved_at: null,
          },
        ],
        cohortLabel: () => "COH-1",
        termLabel: () => "الفصل الأول",
        systemLabel: () => "نظامي",
      }),
    );
    expect(hc.headers).toContain("عدد الجدولة");
    expect(hc.body[0]).toContain(47);

    const dg = buildAdminExportTable(
      deliveryGroupsExportDataset({
        rows: [
          {
            group_code: "G1",
            group_number: 1,
            component_type: "practical",
            expected_students: 38,
            capacity_limit: 38,
            is_obsolete: false,
            excluded_from_workload: false,
            assigned: true,
          },
        ],
        componentLabel: () => "عملي",
      }),
    );
    expect(dg.body[0]).toContain("مسند");
    expect(dg.body[0]).toContain("نشطة");
  });
});
