import assert from "node:assert/strict";
import {
  analyzeRoomCapacities,
  roomCapacityReadinessMetrics,
} from "../../src/lib/reports/room-capacity-readiness";
import { classifyMetricSeverity } from "../../src/lib/data-onboarding/classify";

const types = [
  { id: "lecture", default_capacity: 75 },
  { id: "lab", default_capacity: 42 },
];
const rooms = [
  { id: "r1", room_type_id: "lecture", room_type: "lecture_hall", capacity: 75 },
  { id: "large", room_type_id: "lecture", room_type: "lecture_hall", capacity: 192 },
  { id: "lab1", room_type_id: "lab", room_type: "computer_lab", capacity: 42 },
  { id: "lab2", room_type_id: "lab", room_type: "computer_lab", capacity: 42 },
];

assert.deepEqual(analyzeRoomCapacities(rooms, types).mixedTypeIds, ["lecture"]);
const metrics = roomCapacityReadinessMetrics(rooms, types);
assert.equal(metrics.filter((m) => m.missing > 0).length, 0);
assert.equal(
  metrics.some((m) => classifyMetricSeverity(m) === "BLOCKER"),
  false,
);
assert.equal(
  metrics.some((m) => m.label.includes("بسعات غير موحدة")),
  false,
);

const invalid = roomCapacityReadinessMetrics(
  [...rooms, { id: "broken", room_type_id: "lab", room_type: "computer_lab", capacity: 0 }],
  types,
);
assert.equal(invalid.find((m) => m.label === "قاعات بسعة ≤ 0")?.missing, 1);
assert.equal(classifyMetricSeverity(invalid.find((m) => m.label === "قاعات بسعة ≤ 0")!), "BLOCKER");

console.log("room capacity readiness: PASS");
