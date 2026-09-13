import { describe, it, beforeEach } from "bun:test";
import assert from "node:assert/strict";
import { mock } from "bun:test";

/**
 * Regression: cloning a schedule version (e.g. the "backup before rebuild"
 * flow) must preserve every operational identity key on schedule_sessions —
 * especially delivery_group_id, cohort_id and plan_course_component_id.
 * Dropping them produced a backup whose sessions existed but were invisible
 * to the delivery-coverage guard (1/354 while 331 sessions existed).
 */

const SOURCE_VERSION = "source-version-1";
const NEW_VERSION = "new-version-1";

const sourceVersion = {
  id: SOURCE_VERSION,
  college_id: "college-1",
  academic_term_id: "term-1",
  name: "الأصل",
  status: "draft",
  notes: null,
};

// A V2-style session with full identity keys.
const sourceSession = {
  id: "session-1",
  college_id: "college-1",
  schedule_version_id: SOURCE_VERSION,
  course_offering_id: "offering-1",
  teaching_assignment_id: "assignment-1",
  instructor_id: "instructor-1",
  room_id: "room-1",
  section_id: "section-1",
  section_group_id: "sg-1",
  section_subgroup_id: "ssg-1",
  cohort_id: "cohort-1",
  delivery_group_id: "dg-1",
  plan_course_component_id: "pcc-1",
  study_system: "regular",
  day_of_week: 1,
  start_time: "09:00:00",
  end_time: "11:00:00",
  session_type: "theory",
  expected_students: 40,
  source_type: "auto_v2",
  is_locked: true,
  lock_reason: "مثبتة يدويًا",
};

let insertedSessionRows: Array<Record<string, unknown>> = [];
let insertedEventRows: Array<Record<string, unknown>> = [];

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    if (table === "schedule_versions") return [sourceVersion];
    if (table === "schedule_sessions") return [structuredClone(sourceSession)];
    return [];
  };
  const filtered = () =>
    rows().filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
  const query: Record<string, unknown> = {
    select() {
      return query;
    },
    eq(key: string, value: unknown) {
      filters[key] = value;
      return query;
    },
    insert(payload: Array<Record<string, unknown>> | Record<string, unknown>) {
      const list = Array.isArray(payload) ? payload : [payload];
      if (table === "schedule_sessions") insertedSessionRows.push(...list);
      if (table === "schedule_version_events") insertedEventRows.push(...list);
      if (table === "schedule_versions") {
        return {
          select() {
            return {
              async single() {
                return { data: { id: NEW_VERSION }, error: null };
              },
            };
          },
        };
      }
      return {
        then(resolve: (r: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
    },
    async single() {
      return { data: filtered()[0] ?? null, error: null };
    },
    then(resolve: (r: unknown) => unknown) {
      return Promise.resolve({ data: filtered(), error: null }).then(resolve);
    },
  };
  return query;
}

mock.module("../src/integrations/supabase/client.ts", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from(table: string) {
      return makeQuery(table);
    },
  },
}));

const { cloneVersion } = await import("../src/lib/schedule-versions/lifecycle");

describe("cloneVersion — operational identity preservation", () => {
  beforeEach(() => {
    insertedSessionRows = [];
    insertedEventRows = [];
  });

  it("keeps delivery_group_id, cohort_id and plan_course_component_id on cloned sessions", async () => {
    const newId = await cloneVersion({
      collegeId: "college-1",
      sourceVersionId: SOURCE_VERSION,
      targetTermId: "term-1",
      newName: "نسخة احتياطية قبل إعادة التوليد - اختبار",
    });
    assert.equal(newId, NEW_VERSION);
    assert.equal(insertedSessionRows.length, 1);
    const cloned = insertedSessionRows[0];
    assert.equal(cloned.schedule_version_id, NEW_VERSION);
    assert.equal(cloned.delivery_group_id, "dg-1");
    assert.equal(cloned.cohort_id, "cohort-1");
    assert.equal(cloned.plan_course_component_id, "pcc-1");
    assert.equal(cloned.section_subgroup_id, "ssg-1");
    assert.equal(cloned.teaching_assignment_id, "assignment-1");
    assert.equal(cloned.is_locked, true);
    assert.equal(cloned.lock_reason, "مثبتة يدويًا");
  });

  it("clone coverage inputs match the source (groups_with_sessions / scheduled_hours)", async () => {
    await cloneVersion({
      collegeId: "college-1",
      sourceVersionId: SOURCE_VERSION,
      targetTermId: "term-1",
      newName: "نسخة احتياطية",
    });
    const hours = (rows: Array<Record<string, unknown>>) =>
      rows.reduce((total, row) => {
        const start = String(row.start_time).slice(0, 5);
        const end = String(row.end_time).slice(0, 5);
        return total + (Number(end.slice(0, 2)) - Number(start.slice(0, 2)));
      }, 0);
    const groupsWithSessions = (rows: Array<Record<string, unknown>>) =>
      new Set(
        rows
          .map((row) => row.delivery_group_id)
          .filter((value): value is string => typeof value === "string"),
      ).size;
    assert.equal(groupsWithSessions(insertedSessionRows), groupsWithSessions([sourceSession]));
    assert.equal(hours(insertedSessionRows), hours([sourceSession]));
    assert.equal(insertedEventRows.length, 1);
  });
});
