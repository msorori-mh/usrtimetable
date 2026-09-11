import test from "node:test";
import assert from "node:assert/strict";
import {
  studyPlanReadinessMetrics,
  type ReadinessPlanCourse,
  type ReadinessPlanComponent,
} from "../src/lib/academic-delivery/study-plan-readiness";
const plan = (id = "p", extra = {}): ReadinessPlanCourse => ({
  id,
  course_id: id,
  level_id: "l",
  semester: 1,
  lectures_per_week: 0,
  labs_per_week: 0,
  lecture_session_duration: 2,
  lab_session_duration: 2,
  ...extra,
});
const part = (kind: string, hours: number, extra = {}): ReadinessPlanComponent => ({
  plan_course_id: "p",
  component_type: kind,
  weekly_contact_hours: hours,
  is_timetabled: true,
  ...extra,
});
const metrics = (p: ReadinessPlanCourse, c: ReadinessPlanComponent[], missingRooms = 0) =>
  studyPlanReadinessMetrics([{ id: p.id }], [p], c, missingRooms);
const omissions = (m: ReturnType<typeof metrics>) => m.filter((x) => x.missing > 0);

test("practical-only courses do not require lectures or their duration", () => {
  assert.deepEqual(
    omissions(
      metrics(plan("p", { labs_per_week: 1, lecture_session_duration: null }), [
        part("practical", 2),
      ]),
    ),
    [],
  );
});
test("summer training and unscheduled zero-hour projects do not require weekly sessions", () => {
  for (const [kind, hours] of [
    ["summer_training", 6],
    ["project", 0],
  ] as const) {
    assert.deepEqual(
      omissions(
        metrics(
          plan("p", { semester: 3, lecture_session_duration: null, lab_session_duration: null }),
          [part(kind, hours, { is_timetabled: false })],
        ),
      ),
      [],
    );
  }
});
test("positive theory, tutorial and practical hours reveal zero or incorrect counters", () => {
  const parts = [part("theory", 2), part("tutorial", 2), part("practical", 3)];
  assert.equal(omissions(metrics(plan(), parts)).length, 2);
  assert.equal(
    omissions(metrics(plan("p", { lectures_per_week: 1, labs_per_week: 1 }), parts)).length,
    2,
  );
  assert.deepEqual(
    omissions(
      metrics(
        plan("p", { lectures_per_week: 2, labs_per_week: 1, lab_session_duration: 3 }),
        parts,
      ),
    ),
    [],
  );
});
test("zero-hour timetabled components and missing room types remain blockers", () => {
  const m = omissions(metrics(plan(), [part("project", 0)], 1));
  assert.equal(m.length, 2);
  assert.ok(m.every((x) => x.critical));
});
test("component hours are scoped by plan course, including shared course identities", () => {
  const plans = [plan(), plan("q", { lectures_per_week: 1 })];
  const m = studyPlanReadinessMetrics(
    plans,
    plans,
    [
      part("theory", 2, { plan_course_id: "q" }),
      part("summer_training", 6, { is_timetabled: false }),
    ],
    0,
  );
  assert.deepEqual(omissions(m), []);
});
test("legacy plans without components still expose absent counters", () => {
  assert.equal(omissions(metrics(plan(), [])).length, 1);
  assert.deepEqual(omissions(metrics(plan("p", { lectures_per_week: 1 }), [])), []);
});
test("a missing required duration and a stale positive counter cannot pass", () => {
  assert.equal(
    omissions(
      metrics(plan("p", { lectures_per_week: 1, lecture_session_duration: null }), [
        part("theory", 2),
      ]),
    ).length,
    1,
  );
  assert.equal(
    omissions(metrics(plan("p", { lectures_per_week: 1 }), [part("practical", 2)])).length,
    2,
  );
});
