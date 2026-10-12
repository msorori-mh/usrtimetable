import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCoverage,
  parseFacultyCategories,
  summarizeCoverage,
  coverageDisplayRows,
  type CoverageFact,
} from "../src/lib/reports/teaching-coverage.ts";
const f: CoverageFact = {
  identity_id: "a",
  instructor: "محاضر",
  university_number: "1",
  home_college_name: "كلية",
  category: "internal",
  program_id: "p",
  program: "برنامج",
  department_id: "d",
  department: "قسم",
  study_system: "regular",
  hours: 3,
  project: 0,
  allocation_pending: false,
};
test("exclusive source totals reconcile and retain unknown classification", () => {
  const s = summarizeCoverage([
    f,
    { ...f, identity_id: "b", category: "other_college", hours: 2.5 },
    { ...f, identity_id: "c", category: "contractual", hours: 4 },
    { ...f, identity_id: "d", category: "unknown", hours: 1 },
  ]);
  assert.equal(s.total, 10.5);
  assert.equal(s.internal + s.other_college + s.contractual + s.unknown, s.total);
});
test("pending allocation is not a confirmed zero or payable hours", () => {
  const rows = [{ ...f, allocation_pending: true, project: 6 }];
  const s = summarizeCoverage(rows);
  assert.equal(s.total, 0);
  assert.equal(s.pendingMembers, 1);
  assert.equal(s.project, 6);
  assert.equal(coverageDisplayRows(rows)[0].hours, null);
});
test("system filtering is additive without counting project supervision", () => {
  const rows = [f, { ...f, study_system: "parallel" as const, hours: 5, project: 20 }];
  assert.equal(summarizeCoverage(rows).total, 8);
  assert.equal(summarizeCoverage(rows.filter((r) => r.study_system === "parallel")).total, 5);
});
test("parser rejects mismatched scopes, duplicate facts and invalid hours", () => {
  const payload = { college_id: "c", term_id: "t", rows: [f] };
  assert.equal(parseCoverage(payload, "c", "t").length, 1);
  for (const bad of [
    { ...payload, college_id: "x" },
    { ...payload, term_id: "x" },
    { ...payload, rows: [f, f] },
    { ...payload, rows: [{ ...f, hours: -1 }] },
    { ...payload, rows: [{ ...f, category: "invented" }] },
  ])
    assert.throws(() => parseCoverage(bad, "c", "t"));
});
test("directory classification requires matching scope and unique identities", () => {
  const payload = { college_id: "c", rows: [{ identity_id: "a", category: "contractual" }] };
  assert.equal(parseFacultyCategories(payload, "c").get("a"), "contractual");
  assert.throws(() => parseFacultyCategories(payload, "x"));
  assert.throws(() =>
    parseFacultyCategories({ ...payload, rows: [...payload.rows, ...payload.rows] }, "c"),
  );
});

import { canManageTeachingPay } from "../src/lib/viewer-roles.ts";
test("money and rate screens are exclusive to academic affairs and super admin", () => {
  assert.equal(canManageTeachingPay({ isSuperAdmin: true }), true);
  assert.equal(canManageTeachingPay({ isInstitutionalViewer: true }), true);
  for (const me of [
    null,
    {},
    { isUniversityLeadership: true },
    { isCollegeDean: true },
    { isCollegeAdmin: true },
    { isReadOnly: true },
  ])
    assert.equal(canManageTeachingPay(me), false);
});
