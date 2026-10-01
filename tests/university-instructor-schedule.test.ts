import { describe, expect, test } from "bun:test";
import {
  facultyRecordIds,
  mergeInstructorDirectories,
  instructorsByHomeCollege,
  instructorScheduleForScope,
  parseInstructorScheduleScope,
  canViewInstructorAcrossColleges,
  instructorTeachingScopes,
  overlappingTerms,
  resolveCollegeScheduleScopes,
  summarizeUniversitySchedule,
  type UniversityInstructorSession,
  type UniversityTerm,
  type UniversityVersion,
} from "../src/lib/reports/university-instructor-schedule";

const term = (
  id: string,
  college_id: string,
  start_date = "2026-09-01",
  end_date = "2026-12-31",
): UniversityTerm => ({ id, college_id, start_date, end_date, name: "الفصل الأول" });
const version = (
  id: string,
  college_id: string,
  academic_term_id: string,
  status = "published",
  created_at = "2026-09-01",
): UniversityVersion => ({
  id,
  college_id,
  academic_term_id,
  status,
  created_at,
  name: id,
  is_coordination: false,
});
const session = (
  id: string,
  college_id: string,
  start_time = "08:00",
  end_time = "10:00",
): UniversityInstructorSession => ({
  id,
  college_id,
  college_name: college_id,
  version_name: "V1",
  day_of_week: 6,
  start_time,
  end_time,
  session_type: "lecture",
  study_system: "regular",
  course_code: id,
  course_name: id,
  instructor_name: "Test",
  room_label: "R1",
  section_number: "",
  cohort_label: "",
  delivery_group_label: "",
  program_name: "",
  level_name: "",
  department_name: "",
});

describe("university instructor schedule", () => {
  test("uses canonical IDs and verified numbers; never joins by same name", () => {
    const records = [
      { id: "home", university_number: "U1" },
      { id: "alias", university_number: "U1" },
      { id: "other", university_number: "U2" },
    ];
    expect(facultyRecordIds(records[0], records)).toEqual(["home", "alias"]);
    expect(facultyRecordIds({ id: "home", university_number: null }, records)).toEqual(["home"]);
  });
  test("scoped picker retains verified aliases without loading unrelated faculty", () => {
    const selected = {
      id: "canonical",
      university_number: "U1",
      record_ids: ["legacy-in-itcs", "canonical", "legacy-in-arts"],
    };
    expect(facultyRecordIds(selected, [selected])).toEqual([
      "canonical",
      "legacy-in-itcs",
      "legacy-in-arts",
    ]);
  });
  test("same term name in a previous academic year cannot enter the report", () => {
    expect(overlappingTerms(term("a", "c1"), term("b", "c2", "2025-09-01", "2025-12-31"))).toBe(
      false,
    );
    expect(overlappingTerms(term("a", "c1"), term("b", "c2"))).toBe(true);
  });
  const input = {
    colleges: [
      { id: "c1", name: "Computing" },
      { id: "c2", name: "Business" },
    ],
    terms: [term("t1", "c1"), term("t2", "c2"), term("old", "c2", "2025-09-01", "2025-12-31")],
    versions: [
      version("chosen", "c1", "t1", "draft"),
      version("published", "c2", "t2"),
      version("draft", "c2", "t2", "draft", "2026-09-02"),
      version("old", "c2", "old", "published", "2026-09-03"),
    ],
    anchorVersionId: "chosen",
    selections: {},
  };
  test("chooses one version per college and preserves selected working version", () => {
    expect(resolveCollegeScheduleScopes(input).map((s) => s.version.id)).toEqual([
      "chosen",
      "published",
    ]);
    expect(
      resolveCollegeScheduleScopes({ ...input, selections: { c2: "draft" } }).map(
        (s) => s.version.id,
      ),
    ).toEqual(["chosen", "draft"]);
  });
  test("rejects stale or cross-period version selection instead of hiding hours", () => {
    expect(() => resolveCollegeScheduleScopes({ ...input, selections: { c2: "old" } })).toThrow();
    expect(() =>
      resolveCollegeScheduleScopes({
        ...input,
        terms: input.terms.map((t) => ({ ...t, start_date: null })),
      }),
    ).toThrow();
  });
  test("adds both colleges and all study systems without duplicating physical sessions", () => {
    const a = session("a", "c1"),
      b = { ...session("b", "c2", "10:00", "13:30"), study_system: "parallel" };
    const s = summarizeUniversitySchedule([a, a, b], { maxWeeklyHours: 6, adminReleaseHours: 2 });
    expect(s.colleges.map((c) => c.hours)).toEqual([2, 3.5]);
    expect(s.totalHours).toBe(5.5);
    expect(s.balance.netHours).toBe(4);
    expect(s.balance.overloadHours).toBe(1.5);
    expect(s.sessions).toHaveLength(2);
  });
  test("does not invent a zero quota or overload", () => {
    expect(summarizeUniversitySchedule([session("a", "c1")], {}).balance.overloadHours).toBeNull();
    expect(
      summarizeUniversitySchedule([session("a", "c1")], { maxWeeklyHours: 0 }).balance
        .overloadHours,
    ).toBe(2);
  });
  test("marks co-teaching incomplete and rejects malformed times", () => {
    expect(
      summarizeUniversitySchedule([{ ...session("a", "c1"), workload_pending: true }], {}).pending,
    ).toBe(true);
    expect(() => summarizeUniversitySchedule([session("a", "c1", "bad", "12:00")], {})).toThrow();
    expect(() => summarizeUniversitySchedule([session("a", "c1", "12:00", "08:00")], {})).toThrow();
  });
});

describe("instructor college scope isolation", () => {
  const input = {
    colleges: [
      { id: "c1", name: "Computing" },
      { id: "c2", name: "Business" },
      { id: "c3", name: "Arts" },
      { id: "test", name: "TEST_ONLY E2E" },
    ],
    terms: [term("t1", "c1"), term("t2", "c2"), term("t3", "c3"), term("tt", "test")],
    versions: [
      version("v1", "c1", "t1"),
      version("v2", "c2", "t2"),
      version("v3", "c3", "t3"),
      version("vt", "test", "tt"),
      version("TEST_ONLY newest", "c2", "t2", "published", "2026-09-20"),
    ],
    anchorVersionId: "v1",
    selections: {},
  };
  test("excludes fixture colleges and fixture versions before selection", () => {
    const scopes = resolveCollegeScheduleScopes(input);
    expect(scopes.map((s) => s.collegeId)).toEqual(["c1", "c2", "c3"]);
    expect(scopes[1].options.map((v) => v.id)).toEqual(["v2"]);
  });
  test("retains issuing college and only evidenced teaching colleges", () => {
    const scopes = resolveCollegeScheduleScopes(input);
    expect(instructorTeachingScopes(scopes, "c1", ["c2"], true).map((s) => s.collegeId)).toEqual([
      "c1",
      "c2",
    ]);
    expect(instructorTeachingScopes(scopes, "c1", []).map((s) => s.collegeId)).toEqual(["c1"]);
    expect(instructorTeachingScopes(scopes, "c1", ["c3"], true).map((s) => s.collegeId)).toEqual([
      "c1",
      "c3",
    ]);
  });
});

test("only super admin can include other colleges, even with multiple memberships", () => {
  for (const roles of [
    [],
    ["college_admin"],
    ["institutional_viewer"],
    ["university_leadership"],
    ["read_only"],
  ]) {
    expect(canViewInstructorAcrossColleges(roles)).toBe(false);
    const scopes = [
      {
        collegeId: "c1",
        collegeName: "Computing",
        version: version("v1", "c1", "t1"),
        options: [],
      },
      { collegeId: "c2", collegeName: "Business", version: version("v2", "c2", "t2"), options: [] },
    ];
    expect(
      instructorTeachingScopes(
        scopes,
        "c1",
        ["c1", "c2"],
        canViewInstructorAcrossColleges(roles),
      ).map((s) => s.collegeId),
    ).toEqual(["c1"]);
  }
  expect(canViewInstructorAcrossColleges(["super_admin"])).toBe(true);
});

describe("admin individual print scopes", () => {
  test("combines verified identities across directories without joining equal names", () => {
    const records = [
      {
        id: "a",
        identity_id: "faculty-1",
        record_ids: ["a", "legacy"],
        full_name: "Same name",
        home_college_id: "home",
        college_id: "elsewhere",
      },
      {
        id: "alias",
        identity_id: "faculty-1",
        record_ids: ["alias", "a"],
        full_name: "Same name",
        home_college_id: "home",
        college_id: "home",
      },
      {
        id: "b",
        identity_id: "faculty-2",
        record_ids: ["b"],
        full_name: "Same name",
        home_college_id: "other",
        college_id: "home",
      },
      {
        id: "c",
        identity_id: "faculty-3",
        record_ids: ["c"],
        full_name: "Unknown home",
        home_college_id: null,
        college_id: "home",
      },
    ];
    const merged = mergeInstructorDirectories(records);
    expect(merged).toHaveLength(3);
    expect(merged[0].record_ids).toEqual(["a", "legacy", "alias"]);
    expect(instructorsByHomeCollege(merged, "home").map((r) => r.id)).toEqual(["a"]);
    expect(instructorsByHomeCollege(merged, "all")).toHaveLength(3);
    expect(instructorsByHomeCollege(merged, "missing")).toEqual([]);
  });

  test("home print follows academic ownership even when stored in another college", () => {
    const home = { ...session("home", "home"), source_college_id: "current" };
    const parallel = {
      ...session("parallel", "home", "10:00", "11:30"),
      source_college_id: "elsewhere",
      study_system: "parallel",
    };
    const other = { ...session("other", "current"), source_college_id: "home" };
    const all = [home, parallel, other, home];
    const homeSummary = summarizeUniversitySchedule(
      instructorScheduleForScope(all, "home", "home", "current"),
      {},
    );
    expect(homeSummary.sessions.map((s) => s.id)).toEqual(["home", "parallel"]);
    expect(homeSummary.totalHours).toBe(3.5);
    expect(homeSummary.colleges.map((c) => c.collegeId)).toEqual(["home"]);
    expect(
      summarizeUniversitySchedule(instructorScheduleForScope(all, "all", "home", "current"), {})
        .totalHours,
    ).toBe(5.5);
    expect(instructorScheduleForScope(all, "current", "home", "current").map((s) => s.id)).toEqual([
      "other",
    ]);
  });

  test("unknown home produces no invented affiliation or printable sessions", () => {
    const rows = [session("a", "current")];
    expect(instructorScheduleForScope(rows, "home", null, "current")).toEqual([]);
    expect(instructorScheduleForScope(rows, "all", null, "current")).toEqual(rows);
    expect(instructorScheduleForScope(rows, "home", "empty", "current")).toEqual([]);
    expect(parseInstructorScheduleScope("home")).toBe("home");
    expect(parseInstructorScheduleScope("current")).toBe("current");
    expect(parseInstructorScheduleScope("bad")).toBe("all");
    expect(parseInstructorScheduleScope(null)).toBe("all");
  });
});
