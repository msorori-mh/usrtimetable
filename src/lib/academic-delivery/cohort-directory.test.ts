import { describe, expect, it } from "vitest";
import {
  filterCohortDirectory,
  formatCohortCount,
  formatCohortEntryYear,
  EMPTY_COHORT_FILTERS,
  type CohortListRow,
} from "./cohort-directory";

const base: CohortListRow = {
  id: "a",
  code: null,
  program_id: "p1",
  level_id: "l1",
  term_id: "t1",
  study_system: "regular",
  entry_year: 2026,
  expected_students: 1200,
  count_status: "confirmed",
  active: true,
  programName: "برنامج",
  levelName: "المستوى الأول",
  levelNumber: 1,
  termName: "فصل",
};

describe("formatCohortCount", () => {
  it("renders a placeholder for null/undefined", () => {
    expect(formatCohortCount(null)).toBe("بانتظار الاستكمال");
    expect(formatCohortCount(undefined)).toBe("بانتظار الاستكمال");
  });
  it("keeps Arabic locale formatting for real numbers", () => {
    expect(formatCohortCount(1200)).toBe((1200).toLocaleString("ar"));
    expect(formatCohortCount(0)).toBe((0).toLocaleString("ar"));
  });
});

describe("formatCohortEntryYear", () => {
  it("renders a placeholder for null/undefined", () => {
    expect(formatCohortEntryYear(null)).toBe("بانتظار الاستكمال");
    expect(formatCohortEntryYear(undefined)).toBe("بانتظار الاستكمال");
  });
  it("keeps the plain year for real numbers", () => {
    expect(formatCohortEntryYear(2026)).toBe("2026");
  });
});

describe("filterCohortDirectory with null fields", () => {
  it("does not throw when entry_year/expected_students are null", () => {
    const rows: CohortListRow[] = [
      { ...base, id: "null-row", entry_year: null, expected_students: null },
      { ...base, id: "num-row", entry_year: 2025, expected_students: 80 },
    ];
    const result = filterCohortDirectory(rows, EMPTY_COHORT_FILTERS);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("num-row");
    expect(result[1]!.id).toBe("null-row");
  });
  it("search still matches rows with null year/count", () => {
    const rows: CohortListRow[] = [
      { ...base, id: "null-row", entry_year: null, expected_students: null },
    ];
    expect(
      filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, search: "برنامج" }),
    ).toHaveLength(1);
  });
});
