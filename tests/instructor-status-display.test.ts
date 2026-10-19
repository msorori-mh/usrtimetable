import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { availabilityStatusLabelAr } from "../src/lib/instructor-metadata";
import { instructorsExportDataset } from "../src/lib/admin-export/datasets";

// L-14: the instructors page was split into the route + hook + form/search components.
const page = [
  "src/routes/_authenticated/instructors.tsx",
  "src/hooks/use-instructor-directory.ts",
  "src/components/instructors/instructor-form-fields.tsx",
  "src/components/instructors/university-instructor-search.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const report = readFileSync("src/routes/_authenticated/reports.instructors.tsx", "utf8");

describe("lecturer status display uses availability_status only", () => {
  it("instructor card never renders employmentTypeLabelAr", () => {
    expect(page).not.toMatch(/employmentTypeLabelAr/);
    expect(page).toMatch(/الحالة: \{availabilityStatusLabelAr\(i\.availability_status\)\}/);
    // L-13: the weekly hours are rendered through the shared number formatter.
    expect(page).toMatch(
      /\{i\.academic_rank \?\? "—"\} · \{formatDecimal\(i\.max_weekly_hours\)\} س\/أسبوع/,
    );
  });

  it("maps statuses to Arabic labels", () => {
    expect(availabilityStatusLabelAr("external_scholarship")).toBe("إبتعاث خارجي");
    expect(availabilityStatusLabelAr("available")).toBe("متوفر");
  });

  it("report and export headers use الحالة, not contract/full-time labels", () => {
    expect(report).not.toMatch(/employmentTypeLabelAr|حالة التفرغ\/التعاقد/);
    expect(report).toMatch(/\{ key: "availability_status", label: "الحالة" \}/);
    const ds = instructorsExportDataset({
      rows: [
        {
          employee_number: "1",
          full_name: "عبدالوهاب أحمد عفيف",
          department_id: null,
          academic_rank: null,
          employment_type: "full_time",
          availability_status: "external_scholarship",
          max_weekly_hours: 12,
          is_active: false,
        },
      ],
      departmentLabel: () => "",
      categoryLabel: () => "",
      availabilityLabel: (v) => availabilityStatusLabelAr(v),
    });
    const labels = ds.columns.map((c) => c.label);
    expect(labels).toContain("الحالة");
    expect(labels).not.toContain("نوع التعاقد");
    const col = ds.columns.find((c) => c.label === "الحالة")!;
    expect(col.value(ds.rows[0])).toBe("إبتعاث خارجي");
    expect(ds.columns.map((c) => String(c.value(ds.rows[0])))).not.toContain("متفرغ");
  });
});
