import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260920023000_allow_exact_published_shared_clone.sql", import.meta.url),
  "utf8",
);

test("shared lecture clone guard preserves only exact approved/published inserts", () => {
  assert.match(migration, /TG_OP = 'INSERT'/);
  assert.match(migration, /source_version\.status IN \('approved', 'published'\)/);
  for (const identity of [
    "delivery_group_id",
    "course_offering_id",
    "teaching_assignment_id",
    "instructor_id",
    "room_id",
    "section_id",
    "section_group_id",
    "section_subgroup_id",
    "cohort_id",
    "plan_course_component_id",
    "day_of_week",
    "start_time",
    "end_time",
    "session_type",
  ]) {
    assert.match(migration, new RegExp(`source_session\\.${identity}`));
  }
  assert.match(migration, /RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW'/);
  assert.match(migration, /NOT coalesce\(source_session\.replaced_by_split, false\)/);
});

test("shared lecture clone guard remains fail closed for altered placements", () => {
  const windowCheck = migration.indexOf("NOT public.shared_lecture_time_allowed");
  const exactCloneCheck = migration.indexOf("TG_OP = 'INSERT'", windowCheck);
  const rejection = migration.indexOf("RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW'", exactCloneCheck);
  assert.ok(windowCheck >= 0 && exactCloneCheck > windowCheck && rejection > exactCloneCheck);
});
