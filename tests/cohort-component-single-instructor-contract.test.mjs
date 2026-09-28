import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "supabase/migrations/20260928020000_cohort_component_single_instructor.sql";

test("database migration enforces one identity across split theory/practical groups", async () => {
  const sql = await read(migrationPath);

  assert.match(sql, /assert_cohort_component_single_instructor/);
  assert.match(sql, /faculty_identity_links/);
  assert.match(sql, /pcc\.component_type IN \('theory', 'practical'\)/);
  assert.match(sql, /v_group_count < 2/);
  assert.match(sql, /COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF instructor_id, delivery_group_id, is_active/);
  assert.match(sql, /get_cohort_component_instructor_readiness/);
  assert.match(sql, /_ss_cohort_component_instructor/);
  assert.match(sql, /_ss_cohort_component_instructor\(a,g\)/);
  assert.match(sql, /CHECK \(conflict_code <> 'cohort_component_single_instructor'\)/);

  // The feature reports legacy inconsistencies but never rewrites real data.
  assert.doesNotMatch(sql, /UPDATE\s+public\.teaching_assignments/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.teaching_assignments/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.delivery_groups/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.delivery_groups/i);
});

test("automatic, manual, and conflict-check paths expose the fixed rule", async () => {
  const [autoScheduler, validator, assignmentMessages, scheduleMessages, integration] =
    await Promise.all([
      read("src/lib/auto-scheduler/v2.ts"),
      read("src/lib/conflict-engine/validator.ts"),
      read("src/lib/academic-delivery/teaching-assignments-v2.ts"),
      read("src/lib/schedule-builder/conflict-code-messages.ts"),
      read("src/lib/schedule-builder/v2-assignment-integration.ts"),
    ]);

  assert.match(autoScheduler, /getCohortComponentInstructorReadiness/);
  assert.match(autoScheduler, /single-component-instructor/);
  assert.match(validator, /cohort_component_single_instructor/);
  assert.match(assignmentMessages, /COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED/);
  assert.match(scheduleMessages, /cohort_component_single_instructor/);
  assert.match(integration, /cohort_component_single_instructor/);
});
