import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_CANDIDATE_FIELDS,
  candidateCollegeOptions,
  defaultSourceCollegeId,
  filterCandidatesByCollege,
  parseAssignmentCandidates,
} from "../src/lib/teaching-assignments/cross-college-candidates";

const root = resolve(import.meta.dir, "..");
const HOME = "7168345f-cf9d-4789-b2ad-547abb687dc8"; // ITCS
const OTHER = "f30ff526-3918-4395-b8a0-dff1873534bf"; // Business

const payload = {
  ok: true,
  college_id: HOME,
  candidates: [
    {
      instructor_id: "i-1",
      full_name: "أحمد الشامي",
      academic_rank: "assistant_professor",
      home_college_id: HOME,
      college_name: "كلية تكنولوجيا المعلومات",
      is_home_college: true,
      employee_number: "1001",
      already_assigned: false,
      email: "leak@example.com",
      phone: "777",
    },
    {
      instructor_id: "i-2",
      full_name: "سالم الجوفي",
      academic_rank: "lecturer",
      home_college_id: OTHER,
      college_name: "كلية العلوم الإدارية والمالية",
      is_home_college: false,
      employee_number: null,
      already_assigned: false,
    },
    {
      instructor_id: "i-3",
      full_name: "مسند سابقاً",
      home_college_id: HOME,
      college_name: "كلية تكنولوجيا المعلومات",
      is_home_college: true,
      already_assigned: true,
    },
  ],
};

describe("cross-college instructor candidates", () => {
  test("parses only whitelisted public fields (no private profile data)", () => {
    const parsed = parseAssignmentCandidates(payload);
    expect(parsed).toHaveLength(3);
    for (const c of parsed) {
      for (const key of Object.keys(c)) {
        expect(ALLOWED_CANDIDATE_FIELDS as readonly string[]).toContain(key);
      }
    }
    expect(JSON.stringify(parsed).includes("leak@example.com")).toBe(false);
    expect(JSON.stringify(parsed).includes("777")).toBe(false);
  });

  test("employee number is only carried for the delivery group's own college", () => {
    const parsed = parseAssignmentCandidates(payload);
    expect(parsed.find((c) => c.instructor_id === "i-1")?.employee_number).toBe("1001");
    expect(parsed.find((c) => c.instructor_id === "i-2")?.employee_number).toBeNull();
  });

  test("source college options put the group's own college first", () => {
    const options = candidateCollegeOptions(parseAssignmentCandidates(payload));
    expect(options.map((o) => o.college_id)).toEqual([HOME, OTHER]);
    expect(options[0]!.is_home_college).toBe(true);
  });

  test("selecting another college lists that college's instructors by canonical id", () => {
    const parsed = parseAssignmentCandidates(payload);
    const cross = filterCandidatesByCollege(parsed, OTHER);
    expect(cross.map((c) => c.instructor_id)).toEqual(["i-2"]);
    expect(cross[0]!.home_college_id).toBe(OTHER);
  });

  test("already-assigned instructors are excluded, no duplicate identities", () => {
    const parsed = parseAssignmentCandidates(payload);
    const home = filterCandidatesByCollege(parsed, HOME);
    expect(home.map((c) => c.instructor_id)).toEqual(["i-1"]);
    const ids = parsed.map((c) => c.instructor_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("default source college is the delivery group's college when available", () => {
    const parsed = parseAssignmentCandidates(payload);
    expect(defaultSourceCollegeId(parsed, HOME)).toBe(HOME);
    expect(defaultSourceCollegeId(parsed, "unknown-college")).toBe(HOME);
    expect(defaultSourceCollegeId([], HOME)).toBe("");
  });

  test("malformed payloads degrade to an empty list instead of throwing", () => {
    expect(parseAssignmentCandidates(null)).toEqual([]);
    expect(parseAssignmentCandidates({ candidates: "nope" })).toEqual([]);
    expect(parseAssignmentCandidates({ candidates: [{ full_name: "بلا معرف" }] })).toEqual([]);
  });
});

describe("assignment dialog wiring", () => {
  const page = readFileSync(resolve(root, "src/routes/_authenticated/teaching-assignments.tsx"), "utf8");

  test("renders a source-college picker plus loading/error/empty states", () => {
    expect(page.includes('data-testid="ta-v2-source-college-select"')).toBe(true);
    expect(page.includes('data-testid="ta-v2-candidates-loading"')).toBe(true);
    expect(page.includes('data-testid="ta-v2-candidates-error"')).toBe(true);
    expect(page.includes('data-testid="ta-v2-candidates-empty"')).toBe(true);
    expect(page.includes('data-testid="ta-v2-cross-college-note"')).toBe(true);
  });

  test("the combobox is fed by the selected college's candidates only", () => {
    expect(page.includes("filterCandidatesByCollege")).toBe(true);
    expect(page.includes("candidates={collegeCandidates.map")).toBe(true);
  });

  test("saving stays behind the existing manage-permission gate", () => {
    expect(page.includes("const readOnly = !canManage || workspace.data?.can_manage === false;")).toBe(
      true,
    );
    expect(page.includes("{!readOnly && (")).toBe(true);
  });
});

describe("instructor category dropdown states", () => {
  const page = readFileSync(resolve(root, "src/routes/_authenticated/instructors.tsx"), "utf8");

  test("exposes loading, error and empty states for categories", () => {
    expect(page.includes('data-testid="instructor-category-loading"')).toBe(true);
    expect(page.includes('data-testid="instructor-category-error"')).toBe(true);
    expect(page.includes('data-testid="instructor-category-empty"')).toBe(true);
  });

  test("category query surfaces query errors instead of swallowing them", () => {
    expect(page.includes("isError: typesError")).toBe(true);
    expect(page.includes("if (error) throw error;\n      return data ?? [];")).toBe(true);
  });
});
