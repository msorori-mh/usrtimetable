import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewLeadership,
  isLeadershipOnlyRole,
  resolveViewerScopeRedirect,
  assignsAllColleges,
  requiresCollegeAssignment,
} from "../src/lib/viewer-roles";
import {
  leadershipOverviewSchema,
  leadershipNotice,
  coveragePercent,
  sumLeadership,
  orderedLeadershipCounts,
  sumLeadershipCounts,
  sortLeadershipColleges,
  type LeadershipCollege,
} from "../src/lib/reports/leadership";

test("leadership has its own landing page and cannot reach operational/user-management pages", () => {
  const me = { isUniversityLeadership: true };
  assert.equal(canViewLeadership(me), true);
  assert.equal(isLeadershipOnlyRole(me), true);
  for (const path of ["/users", "/instructors", "/schedule-builder", "/dashboard"]) {
    assert.equal(resolveViewerScopeRedirect(me, path), "/reports/leadership");
  }
  assert.equal(resolveViewerScopeRedirect(me, "/reports/academic-affairs"), null);
  assert.equal(canViewLeadership({ isReadOnly: true }), false);
  assert.equal(canViewLeadership({ isCollegeAdmin: true }), false);
  assert.equal(resolveViewerScopeRedirect({ isSuperAdmin: true, ...me }, "/users"), null);
});
test("leadership never creates college-admin memberships", () => {
  assert.equal(assignsAllColleges("university_leadership"), false);
  assert.equal(requiresCollegeAssignment("university_leadership"), false);
  assert.equal(requiresCollegeAssignment("read_only"), true);
});
test("unknown denominators remain unknown and partial data is explicit", () => {
  const row = {
    required_hours: null,
    covered_hours: null,
    term_state: "missing",
  } as LeadershipCollege;
  assert.equal(coveragePercent(row), null);
  assert.match(leadershipNotice(row), /غير محسوبة/);
  assert.equal(coveragePercent({ ...row, required_hours: 0, covered_hours: 0 }), null);
  assert.equal(coveragePercent({ ...row, required_hours: 8, covered_hours: 6 }), 75);
  assert.equal(
    sumLeadership([{ ...row, net_quota: 1.25 }, { ...row, net_quota: 2.5 }, row], "net_quota"),
    3.75,
  );
});
test("invalid RPC payload cannot become a plausible zero report", () => {
  for (const value of [null, {}, { year: "2026", colleges: [] }, { colleges: [{ net_quota: -1 }] }])
    assert.equal(leadershipOverviewSchema.safeParse(value).success, false);
});

test("leadership faculty composition sums count maps and preserves executive order", () => {
  const rows = [
    {
      college_id: "00000000-0000-4000-8000-000000000001",
      college: "كلية العلوم الإدارية والمالية",
      rank_counts: { "أستاذ مساعد": 2, "أستاذ": 1 },
      availability_counts: { متاح: 2, "إجازة مرضية": 1 },
      employment_counts: { full_time: 2, contract: 1 },
    },
    {
      college_id: "00000000-0000-4000-8000-000000000002",
      college: "كلية تكنولوجيا المعلومات وعلوم الحاسوب",
      rank_counts: { "أستاذ مساعد": 3 },
      availability_counts: { متاح: 2, "تفرغ علمي": 1 },
      employment_counts: { full_time: 3 },
    },
  ] as unknown as LeadershipCollege[];

  assert.equal(sortLeadershipColleges(rows)[0].college, "كلية تكنولوجيا المعلومات وعلوم الحاسوب");
  assert.deepEqual(sumLeadershipCounts(rows, "rank_counts"), {
    "أستاذ مساعد": 5,
    أستاذ: 1,
  });
  assert.deepEqual(sumLeadershipCounts(rows, "availability_counts"), {
    متاح: 4,
    "إجازة مرضية": 1,
    "تفرغ علمي": 1,
  });
  assert.deepEqual(
    orderedLeadershipCounts(
      { "أستاذ مساعد": 5, أستاذ: 1 },
      ["أستاذ", "أستاذ مساعد"],
    ),
    [
      ["أستاذ", 1],
      ["أستاذ مساعد", 5],
    ],
  );
});
