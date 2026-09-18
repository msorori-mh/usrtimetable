import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeFacultySessions,
  type FacultySession,
} from "../src/lib/instructors/university-report.ts";
const s = (
  id: string,
  college: string,
  start: string,
  end: string,
  type = "lecture",
): FacultySession => ({
  id,
  college,
  college_id: college,
  version_id: college,
  day: 6,
  start,
  end,
  type,
  course: "مقرر",
  room: "قاعة",
  study_system: "regular",
});
test("shared source membership never duplicates the same physical session", () => {
  const a = s("a", "arts", "08:00", "10:00");
  const result = summarizeFacultySessions([
    a,
    a,
    s("b", "it", "10:00", "12:00", "lab"),
  ]);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.total, 4);
  assert.equal(result.theory, 2);
  assert.equal(result.practical, 2);
  assert.equal(result.conflicts.length, 0);
});
test("cross-college overlap is surfaced without silently removing hours", () => {
  const result = summarizeFacultySessions([
    s("a", "arts", "08:00", "10:00"),
    s("b", "it", "09:00", "11:00"),
  ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.total, 4);
});
test("adjacent sessions and different days are not conflicts", () => {
  const result = summarizeFacultySessions([
    s("a", "arts", "08:00", "10:00"),
    s("b", "it", "10:00", "12:00"),
    { ...s("c", "it", "08:00", "10:00"), day: 0 },
  ]);
  assert.equal(result.conflicts.length, 0);
});
