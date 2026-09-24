import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSearchUniversityRoster,
  collegesInUniversity,
  distinctUniversityRosterHits,
} from "../src/lib/instructors/university-roster-search.ts";

test("university search requires the Super Admin role and a meaningful term", () => {
  assert.equal(canSearchUniversityRoster(false, "أحمد"), false);
  assert.equal(canSearchUniversityRoster(false, "12345"), false);
  assert.equal(canSearchUniversityRoster(true, " أ "), false);
  assert.equal(canSearchUniversityRoster(true, "أح"), true);
  assert.equal(canSearchUniversityRoster(true, "12"), true);
});

test("the search stays within the selected university and excludes disposable colleges", () => {
  const colleges = [
    { id: "a", university_id: "one", name: "التربية" },
    { id: "b", university_id: "one", name: "TEST_ONLY staging" },
    { id: "c", university_id: "two", name: "التربية" },
  ];
  assert.deepEqual(
    collegesInUniversity(colleges, "one").map((c) => c.id),
    ["a"],
  );
  assert.deepEqual(collegesInUniversity(colleges, null), []);
});

test("home record wins over old pending copies of the same university identity", () => {
  const hit = (id, identity, scope, collegeId) => ({
    row: { id, identity_id: identity, full_name: "أحمد" },
    scope,
    collegeId,
    collegeName: collegeId,
  });
  const found = distinctUniversityRosterHits([
    hit("old", "identity-1", "pending", "college-a"),
    hit("native", "identity-1", "home", "college-b"),
    hit("other", "identity-2", "home", "college-a"),
    hit("old-again", "identity-1", "pending", "college-c"),
  ]);
  assert.deepEqual(
    found.map(({ row, collegeId, scope }) => [row.id, collegeId, scope]),
    [
      ["native", "college-b", "home"],
      ["other", "college-a", "home"],
    ],
  );
});
