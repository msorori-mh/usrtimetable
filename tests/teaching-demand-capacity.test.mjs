import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProgramLevelDemand,
  capacityAssessment,
  summarizeDemandCapacity,
  summarizeUniversityCapacity,
} from "../src/lib/reports/teaching-demand-capacity.ts";

const college = {
  college_id: "college-1",
  college: "التربية",
  term_id: "term-1",
  term_state: "ready",
  required_hours: 5,
  groups_count: 2,
  version_id: "published-1",
  teaching_hours: 5,
};
const groups = [
  {
    delivery_group_id: "g1",
    college_id: "college-1",
    cohort_id: "cohort-1",
    term_id: "term-1",
    active: true,
    is_obsolete: false,
    component_type: "theory",
    component_hours: 3,
  },
  {
    delivery_group_id: "g2",
    college_id: "college-1",
    cohort_id: "cohort-2",
    term_id: "term-1",
    active: true,
    is_obsolete: false,
    component_type: "lab",
    component_hours: 2,
  },
];
const cohorts = [
  {
    id: "cohort-1",
    college_id: "college-1",
    term_id: "term-1",
    program_id: "p1",
    level_id: "l1",
    active: true,
  },
  {
    id: "cohort-2",
    college_id: "college-1",
    term_id: "term-1",
    program_id: "p2",
    level_id: "l2",
    active: true,
  },
  {
    id: "cohort-3",
    college_id: "college-1",
    term_id: "term-1",
    program_id: "p2",
    level_id: "l2",
    active: true,
  },
];
const programs = [
  { id: "p1", college_id: "college-1", name: "أ" },
  { id: "p2", college_id: "college-1", name: "ب" },
];
const levels = [
  {
    id: "l1",
    college_id: "college-1",
    program_id: "p1",
    name: "الأول",
    level_number: 1,
  },
  {
    id: "l2",
    college_id: "college-1",
    program_id: "p2",
    name: "الثاني",
    level_number: 2,
  },
];

test("shared lecture appears in both programs, but physical demand counts it once", () => {
  const result = buildProgramLevelDemand({
    colleges: [college],
    groups,
    cohorts,
    programs,
    levels,
    sharedLinks: [
      { anchor_group_id: "g1", cohort_id: "cohort-2" },
      { anchor_group_id: "g1", cohort_id: "cohort-3" },
    ],
  });
  assert.equal(result.physicalHoursByCollege["college-1"], 5);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((r) => r.programId === "p1").requiredHours, 3);
  assert.equal(result.rows.find((r) => r.programId === "p2").requiredHours, 5);
  assert.equal(result.rows.find((r) => r.programId === "p2").sharedHours, 3);
  assert.equal(result.repeatedSharedHoursByCollege["college-1"], 3);
});

test("active cohort with no groups stays visible as incomplete level demand", () => {
  const result = buildProgramLevelDemand({
    colleges: [college],
    groups,
    cohorts: [...cohorts, {
      id: "cohort-4", college_id: "college-1", term_id: "term-1",
      program_id: "p2", level_id: "l3", active: true,
    }],
    programs,
    levels: [...levels, {
      id: "l3", college_id: "college-1", program_id: "p2",
      name: "الثالث", level_number: 3,
    }],
    sharedLinks: [],
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.find((r) => r.levelId === "l3").groups, 0);
  assert.equal(result.rows.find((r) => r.levelId === "l3").cohortsWithoutGroups, 1);
  assert.equal(result.physicalHoursByCollege["college-1"], 5);
});

test("missing hours and disagreement with the executive overview fail closed", () => {
  const input = {
    colleges: [college],
    groups,
    cohorts,
    programs,
    levels,
    sharedLinks: [],
  };
  assert.throws(
    () =>
      buildProgramLevelDemand({
        ...input,
        groups: [{ ...groups[0], component_hours: null }, groups[1]],
      }),
    /ساعات/,
  );
  assert.throws(
    () =>
      buildProgramLevelDemand({
        ...input,
        colleges: [{ ...college, required_hours: 6 }],
      }),
    /لا تطابق/,
  );
  assert.throws(
    () =>
      buildProgramLevelDemand({
        ...input,
        sharedLinks: [{ anchor_group_id: "g1", cohort_id: "missing" }],
      }),
    /رابط/,
  );
});

test("partial college data cannot become a university surplus", () => {
  const complete = {
    id: "college-1",
    name: "التربية",
    rooms: [{ id: "r1" }],
    requiredHours: 5,
    availableHours: 12,
    balanceHours: 7,
    issues: [],
  };
  const secondCollege = {
    ...college,
    college_id: "college-2",
    college: "الآداب",
    version_id: null,
    required_hours: 3,
  };
  const secondCapacity = {
    ...complete,
    id: "college-2",
    name: "الآداب",
    requiredHours: 3,
    availableHours: 10,
    balanceHours: 7,
    issues: [],
  };
  const rows = summarizeDemandCapacity(
    [college, secondCollege],
    [complete, secondCapacity],
  );
  assert.equal(rows[0].status, "calculable");
  assert.equal(rows[1].status, "partial");
  assert.match(capacityAssessment(rows[0]), /فحص النوع والموعد/);
  const university = summarizeUniversityCapacity(rows);
  assert.equal(university.calculable, 1);
  assert.equal(university.requiredHours, null);
  assert.equal(university.availableHours, null);
  assert.equal(university.balanceHours, null);
});
