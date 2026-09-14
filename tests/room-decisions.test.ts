import assert from "node:assert/strict";
import test from "node:test";
import {
  capacityPoints,
  suggestRoomMoves,
  roomClosed,
  roomOpen,
} from "../src/lib/reports/room-decisions.ts";
const rooms = [
  { id: "large", name: "large", capacity: 75, room_type: "computer_lab", is_active: true },
  { id: "small", name: "small", capacity: 30, room_type: "computer_lab", is_active: true },
];
const session = {
  id: "s",
  room_id: "large",
  teaching_assignment_id: "ta",
  day_of_week: 1,
  start_time: "08:00:00",
  end_time: "10:00:00",
  expected_students: 25,
  study_system: "regular",
};
const params = () => ({
  rooms,
  sessions: [session],
  visibleIds: new Set(["s"]),
  requiredTypes: new Map([["ta", "computer_lab"]]),
  availability: [],
  closures: [],
  settings: { working_days: [1], day_start_time: "08:00", day_end_time: "16:00" },
});
test("recommends smaller same-type room, preserving session", () => {
  const moves = suggestRoomMoves(params());
  assert.equal(moves.length, 1);
  assert.equal(moves[0].savedSeats, 45);
  assert.equal(moves[0].session, session);
});
test("parallel occupancy blocks recommendation for regular filter", () => {
  const p = params();
  p.sessions.push({ ...session, id: "parallel", room_id: "small", study_system: "parallel" });
  assert.equal(suggestRoomMoves(p).length, 0);
});
test("adjacent lecture does not conflict", () => {
  const p = params();
  p.sessions.push({
    ...session,
    id: "next",
    room_id: "small",
    start_time: "10:00",
    end_time: "12:00",
  });
  assert.equal(suggestRoomMoves(p).length, 1);
});
test("unknown requirements, missing headcount, lock and wrong type suppress advice", () => {
  const p = params();
  p.requiredTypes.clear();
  assert.equal(suggestRoomMoves(p).length, 0);
  assert.equal(
    suggestRoomMoves({ ...params(), sessions: [{ ...session, expected_students: null }] }).length,
    0,
  );
  assert.equal(
    suggestRoomMoves({ ...params(), sessions: [{ ...session, is_locked: true }] }).length,
    0,
  );
  assert.equal(
    suggestRoomMoves({ ...params(), rooms: [rooms[0], { ...rooms[1], room_type: "lecture_hall" }] })
      .length,
    0,
  );
});
test("capacity and closure constraints are enforced", () => {
  assert.equal(
    suggestRoomMoves({ ...params(), sessions: [{ ...session, expected_students: 31 }] }).length,
    0,
  );
  assert.equal(
    suggestRoomMoves({
      ...params(),
      closures: [
        { room_id: "small", day_of_week: 1, start_date: "2026-09-14", end_date: "2026-09-14" },
      ],
    }).length,
    0,
  );
  assert.equal(
    roomClosed("small", 1, "08:00", "10:00", [{ room_id: "small", day_of_week: 2 }]),
    false,
  );
});
test("room windows override general hours and normalize seconds", () => {
  assert.equal(
    roomOpen(
      "small",
      1,
      "08:00",
      "10:00",
      [{ room_id: "small", day_of_week: 1, start_time: "08:00:00", end_time: "10:00:00" }],
      params().settings,
    ),
    true,
  );
  assert.equal(
    roomOpen(
      "small",
      1,
      "08:00",
      "10:00",
      [{ room_id: "small", day_of_week: 2, start_time: "08:00", end_time: "16:00" }],
      params().settings,
    ),
    false,
  );
});
test("scatter excludes missing headcounts rather than treating null as zero", () => {
  const points = capacityPoints(rooms, [
    session,
    { ...session, id: "missing", expected_students: null },
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].students, 25);
  assert.equal(points[0].known, 1);
});
