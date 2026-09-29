import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateLeadershipRoomCapacity,
  buildLeadershipRoomCapacity,
  roomHourEquivalents,
  publishedInstructorPercent,
  type CapacityCollege,
  type CapacitySources,
} from "../src/lib/reports/leadership-room-capacity";

const college = (id = "a", extra: Partial<CapacityCollege> = {}): CapacityCollege => ({
  college_id: id,
  college: `كلية ${id}`,
  term_id: `t-${id}`,
  term_state: "ready",
  version_id: `v-${id}`,
  room_count: 2,
  groups_count: 10,
  required_hours: 2,
  teaching_hours: 2,
  ...extra,
});
function source(): CapacitySources {
  return {
    rooms: ["r1", "r2"].map((id) => ({
      id,
      college_id: "a",
      name: id,
      code: id,
      room_type_id: "hall",
      capacity: 75,
      is_active: true,
      available_days: null,
      available_start_time: null,
      available_end_time: null,
    })),
    settings: [
      {
        college_id: "a",
        working_days: [6, 0, 1, 2, 3, 4],
        day_start_time: "08:00",
        day_end_time: "14:00",
      },
    ],
    availability: [],
    sessions: [
      {
        id: "s1",
        room_id: "r1",
        schedule_version_id: "v-a",
        day_of_week: 6,
        start_time: "08:00",
        end_time: "10:00",
      },
    ],
    roomTypes: [{ id: "hall", name_ar: "قاعة محاضرات", code: "lecture_hall" }],
  };
}
const analyze = (s = source(), c = college()) => buildLeadershipRoomCapacity([c], s)[0];

test("published instructor coverage requires a complete, reconciled session read", () => {
  const s = source();
  s.sessions[0].instructor_id = "faculty-1";
  const c = college("a", { sessions_count: 1 });
  const named = analyze(s, c);
  assert.equal(named.publishedSessions, 1);
  assert.equal(named.namedPublishedSessions, 1);
  assert.equal(publishedInstructorPercent(named, 1), 100);

  s.sessions[0].instructor_id = null;
  const missingName = analyze(s, c);
  assert.equal(publishedInstructorPercent(missingName, 1), 0);
  assert.equal(publishedInstructorPercent(missingName, 2), null);

  const partial = analyze(s, college("a", { sessions_count: 2 }));
  assert.equal(partial.publishedSessions, null);
  assert.equal(publishedInstructorPercent(partial, 2), null);
  delete s.sessions[0].instructor_id;
  assert.equal(publishedInstructorPercent(analyze(s, c), 1), null);
});

test("laboratories are excluded from lecture-room availability, surplus and details", () => {
  const s = source();
  s.roomTypes.push({ id: "lab", name_ar: "معمل حاسوب", code: "computer_lab" });
  s.rooms.push({
    id: "lab-1",
    college_id: "a",
    name: "معمل 1",
    code: "LAB-1",
    room_type_id: "lab",
    capacity: 30,
    is_active: true,
    available_days: null,
    available_start_time: null,
    available_end_time: null,
  });
  const r = analyze(s, college("a", { room_count: 3 }));
  assert.equal(r.availableHours, 72);
  assert.equal(r.surplusHours, 70);
  assert.deepEqual(
    r.rooms.map((room) => room.id),
    ["r1", "r2"],
  );
});

test("72 available lecture-room hours minus 2 occupied hours yields 70 unused hours", () => {
  const r = analyze();
  assert.equal(r.availableHours, 72);
  assert.equal(r.balanceHours, 70);
  assert.deepEqual(r.equivalents, {
    fullDays: 11,
    hoursAfterDays: 4,
    fullRooms: 1,
    hoursAfterRooms: 34,
    daysAfterRooms: 5,
    hoursAfterRoomsAndDays: 4,
  });
  assert.equal(r.emptyPublishedRooms, 1);
  assert.equal(r.rooms[0].idleHours, 34);
});
test("legacy and generic classroom codes are counted as lecture halls", () => {
  const s = source();
  s.roomTypes[0].code = "LEC";
  assert.equal(analyze(s).rooms.length, 2);
  assert.equal(analyze(s).availableHours, 72);

  s.roomTypes[0].code = "classroom";
  assert.equal(analyze(s).rooms.length, 2);
  assert.equal(analyze(s).availableHours, 72);
});

test("a theory-only college reports unused lecture-room time without a fabricated deficit", () => {
  const r = analyze(source(), college("a", { required_hours: 2, teaching_hours: 2 }));
  assert.equal(r.requiredHours, 2);
  assert.equal(r.balanceHours, 70);
  assert.equal(r.deficitHours, 0);
});

test("exact 6/36 thresholds, fractional hours, zero and invalid values", () => {
  assert.equal(roomHourEquivalents(5.5)?.fullDays, 0);
  assert.equal(roomHourEquivalents(6)?.fullDays, 1);
  assert.equal(roomHourEquivalents(35.5)?.fullRooms, 0);
  assert.equal(roomHourEquivalents(36)?.fullRooms, 1);
  assert.equal(roomHourEquivalents(72)?.fullRooms, 2);
  assert.equal(roomHourEquivalents(0)?.fullRooms, 0);
  for (const n of [null, NaN, Infinity, -1]) assert.equal(roomHourEquivalents(n), null);
});
test("availability overlaps and repeated working days count once", () => {
  const s = source();
  s.settings[0].working_days!.push(6);
  s.availability = [
    {
      id: "a1",
      room_id: "r1",
      day_of_week: 6,
      start_time: "08:00",
      end_time: "12:00",
    },
    {
      id: "a2",
      room_id: "r1",
      day_of_week: 6,
      start_time: "10:00",
      end_time: "14:00",
    },
  ];
  const r = analyze(s);
  assert.equal(r.rooms[0].availableHours, 6);
  assert.equal(r.availableHours, 42);
  assert.equal(r.surplusHours, 40);
});
test("own availability wins over stale fallback columns and stays inside college operating hours", () => {
  const s = source();
  s.rooms[0].available_end_time = "09:00";
  s.availability = [
    {
      id: "a1",
      room_id: "r1",
      day_of_week: 6,
      start_time: "07:00",
      end_time: "16:00",
    },
  ];
  assert.equal(analyze(s).rooms[0].availableHours, 6);
});
test("three-day grand-hall availability stays 18 hours and outside use remains visible", () => {
  const s = source();
  s.rooms = [
    {
      ...s.rooms[0],
      id: "grand",
      name: "القاعة الكبرى",
      code: "R-GRAND",
      available_days: [6, 0, 4],
      available_start_time: "08:00",
      available_end_time: "14:00",
    },
  ];
  s.availability = [6, 0, 4].map((day, index) => ({
    id: `grand-${index}`,
    room_id: "grand",
    day_of_week: day,
    start_time: "08:00",
    end_time: "14:00",
  }));
  s.sessions = [
    {
      id: "inside",
      room_id: "grand",
      schedule_version_id: "v-a",
      day_of_week: 6,
      start_time: "08:00",
      end_time: "10:00",
    },
    {
      id: "outside",
      room_id: "grand",
      schedule_version_id: "v-a",
      day_of_week: 2,
      start_time: "10:00",
      end_time: "12:00",
    },
  ];
  const r = analyze(s, college("a", { room_count: 1, sessions_count: 2 }));
  assert.equal(r.availableHours, 18);
  assert.equal(r.requiredHours, 2);
  assert.equal(r.balanceHours, 16);
  assert.equal(r.rooms[0].availableHours, 18);
  assert.equal(r.rooms[0].occupiedHours, 2);
  assert.equal(r.rooms[0].idleHours, 16);
  assert.match(r.rooms[0].issue!, /خارج الإتاحة 2 س/);
  assert.ok(r.issues.some((issue) => /خارج الإتاحة المعتمدة/.test(issue)));
});
test("room-specific days and time limits apply without availability rows", () => {
  const s = source();
  Object.assign(s.rooms[0], {
    available_days: [6, 0],
    available_start_time: "10:00",
    available_end_time: "13:00",
  });
  assert.equal(analyze(s).rooms[0].availableHours, 6);
});
test("explicit closed room is known zero availability, not an empty usable room", () => {
  const s = source();
  s.rooms[1].available_days = [];
  const r = analyze(s);
  assert.equal(r.availableHours, 36);
  assert.equal(r.emptyPublishedRooms, 0);
});
test("shared session IDs and duplicate room records cannot inflate totals", () => {
  const s = source();
  s.sessions.push({ ...s.sessions[0] });
  s.rooms.push({ ...s.rooms[0] });
  const r = analyze(s);
  assert.equal(r.availableHours, 72);
  assert.equal(r.rooms[0].occupiedHours, 2);
  assert.equal(r.rooms[0].sessionCount, 1);
});
test("draft and superseded publication IDs are excluded", () => {
  const s = source();
  s.sessions.push({
    ...s.sessions[0],
    id: "draft",
    schedule_version_id: "draft",
    end_time: "14:00",
  });
  assert.equal(analyze(s).rooms[0].occupiedHours, 2);
});
test("cross-college use counts against physical room once in selected publications", () => {
  const s = source();
  s.sessions.push({
    ...s.sessions[0],
    id: "b-use",
    room_id: "r2",
    schedule_version_id: "v-b",
  });
  const r = buildLeadershipRoomCapacity([college(), college("b", { room_count: 0 })], s)[0];
  assert.equal(r.emptyPublishedRooms, 0);
  assert.equal(r.rooms[1].occupiedHours, 2);
});
test("inactive rooms are excluded and inventory mismatch prevents a false aggregate", () => {
  const s = source();
  s.rooms[1].is_active = false;
  const r = analyze(s);
  assert.equal(r.availableHours, null);
  assert.equal(r.balanceHours, null);
});
test("missing, duplicate or invalid operating settings do not turn into capacity", () => {
  for (const kind of ["missing", "duplicate", "day", "time"] as const) {
    const s = source();
    if (kind === "missing") s.settings = [];
    if (kind === "duplicate") s.settings.push({ ...s.settings[0] });
    if (kind === "day") s.settings[0].working_days = [8];
    if (kind === "time") s.settings[0].day_end_time = "24:59";
    assert.equal(analyze(s).balanceHours, null, kind);
  }
});
test("one invalid room window makes aggregate unknown while preserving other room details", () => {
  const s = source();
  s.availability = [
    {
      id: "bad",
      room_id: "r1",
      day_of_week: 7,
      start_time: "08:00",
      end_time: "12:00",
    },
  ];
  const r = analyze(s);
  assert.equal(r.balanceHours, null);
  assert.equal(r.rooms[1].availableHours, 36);
});
test("missing publication never fabricates empty-room or idle-hour claims", () => {
  const r = analyze(source(), college("a", { version_id: null, teaching_hours: null }));
  assert.equal(r.balanceHours, null);
  assert.equal(r.emptyPublishedRooms, null);
  assert.equal(r.rooms[0].idleHours, null);
});
test("missing term, publication or published teaching total withholds unused-room claims", () => {
  for (const extra of [
    { term_state: "missing" as const },
    { version_id: null },
    { teaching_hours: null },
    { teaching_hours: 0 },
  ])
    assert.equal(analyze(source(), college("a", extra)).surplusHours, null);
});
test("published room occupancy stays measurable when assignment totals come from a different source", () => {
  const r = analyze(source(), college("a", { required_hours: 90 }));
  assert.equal(r.balanceHours, 70);
  assert.equal(r.deficitHours, 0);
  assert.equal(r.surplusHours, 70);
});
test("overlapping and outside sessions are shown as anomalies, with union occupancy", () => {
  const s = source();
  s.sessions.push({
    ...s.sessions[0],
    id: "s2",
    start_time: "09:00",
    end_time: "15:00",
  });
  const r = analyze(s).rooms[0];
  assert.equal(r.occupiedHours, 6);
  assert.equal(r.idleHours, 30);
  assert.match(r.issue!, /تداخل 1 س، وخارج الإتاحة 1 س/);
});
test("invalid session preserves known capacity but hides occupancy and empty counts", () => {
  const s = source();
  s.sessions[0].end_time = "07:00";
  const r = analyze(s);
  assert.equal(r.availableHours, 72);
  assert.equal(r.rooms[0].occupiedHours, null);
  assert.equal(r.emptyPublishedRooms, null);
});
test("university totals include only colleges with complete published occupancy", () => {
  const rows = [analyze(), analyze(source(), college("a", { version_id: null }))];
  const total = aggregateLeadershipRoomCapacity(rows);
  assert.equal(total.surplusHours, 70);
  assert.equal(total.deficitHours, 0);
  assert.equal(total.knownColleges, 1);
  assert.equal(total.roomsByCollege, 1);
  assert.equal(total.hallCount, 2);
  assert.equal(total.nominalHours, 72);
  assert.equal(total.reconciled, true);
  assert.equal(total.reconciliationDifference, 0);
  assert.equal(total.utilizationPercent, 2.8);
});
test("university pooled equivalent and sum of whole equivalents within each college remain distinct", () => {
  const r = analyze();
  const total = aggregateLeadershipRoomCapacity([r, { ...r, id: "b" }]);
  assert.equal(total.equivalents?.fullRooms, 3);
  assert.equal(total.roomsByCollege, 2);
});
test("partial summaries use the same measured college set in every total; all-unknown is not zero", () => {
  const missing = analyze({ ...source(), settings: [] });
  const total = aggregateLeadershipRoomCapacity([analyze(), missing]);
  assert.equal(total.complete, false);
  assert.equal(total.knownColleges, 1);
  assert.equal(total.availableHours, 72);
  assert.equal(total.requiredHours, 2);
  assert.equal(aggregateLeadershipRoomCapacity([missing]).surplusHours, null);
  assert.equal(aggregateLeadershipRoomCapacity([]).equivalents, null);
});
