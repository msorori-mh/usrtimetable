import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { entityDisplayName, instructorDisplayName } from "../src/lib/entity-display";
import { sessionToExportRow } from "../src/lib/print-center/export-rows";
import { buildRoomsReportSummary } from "../src/lib/print-center/rooms-report";

const read = (path: string) => readFileSync(path, "utf8");

describe("human-readable entity labels", () => {
  test("college selectors use the name and never append the college code", () => {
    expect(entityDisplayName({ name: "كلية تكنولوجيا المعلومات", code: "ITCS" })).toBe(
      "كلية تكنولوجيا المعلومات",
    );
    expect(read("src/components/college-switcher.tsx")).toContain("entityDisplayName(c)");
    expect(read("src/components/reports/reports-college-bar.tsx")).toContain(
      "entityDisplayName(c)",
    );
  });

  test("course labels prefer the course name to its code", () => {
    expect(entityDisplayName({ name: "مقدمة في البرمجة", code: "CS111" })).toBe(
      "مقدمة في البرمجة",
    );
  });

  test("instructor labels prefer the name and omit the employee number", () => {
    expect(instructorDisplayName({ full_name: "أحمد محمد", employee_number: "EMP42" })).toBe(
      "أحمد محمد",
    );
    expect(read("src/components/teaching-assignments/instructor-combobox.tsx")).not.toContain(
      "selected.employee_number",
    );
  });

  test("print rows show course and room names without their codes", () => {
    const row = sessionToExportRow({
      id: "s1",
      day_of_week: 0,
      start_time: "08:00:00",
      end_time: "10:00:00",
      session_type: "lecture",
      course_offerings: { courses: { code: "CS111", name: "مقدمة في البرمجة" } },
      instructors: { full_name: "أحمد محمد" },
      rooms: { code: "LAB-1", name: "المعمل الرئيسي" },
    });
    expect(row.course_name).toBe("مقدمة في البرمجة");
    expect(row.course_code).toBe("");
    expect(row.room).toBe("المعمل الرئيسي");
    expect(JSON.stringify(row)).not.toContain("CS111");
    expect(JSON.stringify(row)).not.toContain("LAB-1");
  });

  test("room report omits the code column and uses the room name", () => {
    const rows = buildRoomsReportSummary({
      rooms: [{ id: "r1", code: "A1", name: "القاعة الكبرى", capacity: 60 }],
      roomTypes: [],
      sessions: [],
      availability: [],
    });
    expect(rows[0]?.room_name).toBe("القاعة الكبرى");
    expect(read("src/lib/print-center/rooms-report.ts")).not.toContain(
      '{ key: "room_code", label: "الرمز" }',
    );
  });
});