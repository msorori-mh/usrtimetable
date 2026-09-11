import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  filterInstructorCandidates,
  instructorMatchesQuery,
  normalizeInstructorSearchQuery,
} from "../src/lib/teaching-assignments/instructor-search";

const candidates = [
  { instructor_id: "ins-1", full_name: "أحمد محمد", employee_number: "EMP42" },
  { instructor_id: "ins-2", full_name: "سارة علي", employee_number: "EMP77" },
  { instructor_id: "ins-3", full_name: "John Smith", employee_number: "9001" },
];

describe("instructor combobox search (TA-SEARCH-01)", () => {
  it("matches by Arabic name", () => {
    const r = filterInstructorCandidates(candidates, "أحمد");
    expect(r.map((c) => c.instructor_id)).toEqual(["ins-1"]);
  });

  it("matches by English name case-insensitively", () => {
    expect(filterInstructorCandidates(candidates, "john")).toEqual([candidates[2]]);
    expect(filterInstructorCandidates(candidates, "SMITH")).toEqual([candidates[2]]);
  });

  it("matches by employee number", () => {
    expect(filterInstructorCandidates(candidates, "EMP42")).toEqual([candidates[0]]);
    expect(filterInstructorCandidates(candidates, "900")).toEqual([candidates[2]]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(normalizeInstructorSearchQuery("  Ahmed  ")).toBe("ahmed");
    expect(instructorMatchesQuery(candidates[0]!, "  emp42 ")).toBe(true);
  });

  it("empty query returns all candidates", () => {
    expect(filterInstructorCandidates(candidates, "   ")).toHaveLength(3);
  });

  it("no match returns an empty list (UI shows لا يوجد مدرس مطابق)", () => {
    expect(filterInstructorCandidates(candidates, "لايوجد")).toEqual([]);
  });

  it("free text can never become a selection value — only candidate ids exist", () => {
    const ids = new Set(candidates.map((c) => c.instructor_id));
    for (const c of filterInstructorCandidates(candidates, "a")) {
      expect(ids.has(c.instructor_id)).toBe(true);
    }
  });
});

describe("assignment dialog wiring", () => {
  const dialog = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");
  const combobox = readFileSync(
    "src/components/teaching-assignments/instructor-combobox.tsx",
    "utf8",
  );

  it("dialog uses InstructorCombobox bound to instructorId used by save flow", () => {
    expect(dialog).toContain("<InstructorCombobox");
    expect(dialog).toContain("onChange={setInstructorId}");
    // save flow unchanged: same instructorId state feeds create mutation
    expect(dialog).toContain("instructorId,");
    expect(dialog).toContain("deliveryGroupId: selected.delivery_group_id");
  });

  it("combobox emits instructor_id on select and keeps empty-state copy", () => {
    expect(combobox).toContain("onChange(c.instructor_id)");
    expect(combobox).toContain("لا يوجد مدرس مطابق");
    expect(combobox).toContain('data-testid="ta-v2-instructor-select"');
    expect(combobox).toContain('role="combobox"');
  });

  it("does not allow creating instructors from typed text", () => {
    expect(combobox).not.toContain("onValueChange={(v) => onChange");
    expect(combobox).not.toContain("إضافة مدرس");
  });
});
