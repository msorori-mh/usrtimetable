import { readFileSync } from "node:fs";
import {
  buildPlanComponentSyncPayload,
  type RoomTypeCatalogEntry,
  validatePlanRowRoomTypes,
} from "../../src/lib/academic-delivery/plan-component-room-types.ts";
import { getEntityMeta } from "../../src/lib/excel-import/registry.ts";

const read = (path: string) => readFileSync(path, "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const collegeId = "10000000-0000-4000-8000-000000000001";
const room: RoomTypeCatalogEntry = {
  id: "40000000-0000-4000-8000-000000000001",
  code: "lecture_hall",
  college_id: collegeId,
  is_active: true,
  default_capacity: 30,
};
const validation = validatePlanRowRoomTypes({
  courseCode: "CS101",
  collegeId,
  catalog: [room],
  hours: {
    theory_hours: 2,
  },
  roomTypeCodes: { required_room_type_code_lecture: "lecture_hall" },
});
assert(validation.errors.length === 0, "existing alias and room validation remains valid");
const payload = buildPlanComponentSyncPayload({
  hours: {
    theory_hours: 2,
  },
  resolvedRoomTypeIds: validation.resolvedIds,
});
assert(payload.length === 1, "one legal component emitted");
assert(payload[0].hours === 2, "legal hours field emitted");
assert(payload[0].required_room_type_id === room.id, "resolved room UUID emitted");

for (const entity of ["study_plan_courses", "full_study_plan"] as const) {
  assert(
    getEntityMeta(entity).commitRpc === "commit_plan_component_import_job_atomic_v2",
    `${entity} maps to the same V2 atomic RPC`,
  );
}

const commit = read("src/lib/excel-import/commit.ts");
assert(
  commit.includes('rpc("commit_plan_component_import_job_atomic_v2"'),
  "plan batch uses the V2 RPC",
);
assert(
  (commit.match(/rpc\("commit_plan_component_import_job_atomic_v2"/g) ?? []).length === 1,
  "caller contains one V2 RPC call",
);
assert(!commit.includes('from("plan_course_components")'), "caller has no component direct DML");
assert(
  !commit.includes("PLAN_COMPONENT_ROOM_TYPE_PERSISTENCE_RPC_REQUIRED"),
  "old blocker removed",
);
assert(
  commit.includes("ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE") &&
    commit.includes("ATOMIC_ROOM_TYPE_PERSISTENCE_COUNT_MISMATCH"),
  "missing RPC and response count mismatch fail closed",
);
assert(
  commit.indexOf("if (error)") < commit.indexOf('payload.status !== "ok"'),
  "RPC error is rejected before success parsing",
);

const forward = read(
  "docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01.sql",
);
assert(
  forward.includes("commit_import_job_atomic_legacy_impl") &&
    forward.includes("ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE"),
  "legacy plan route is retained only behind a fail-closed wrapper",
);
assert(
  !/DELETE\s+FROM|TRUNCATE\s+(?!_atomic_plan_apply_rows)/i.test(forward),
  "forward draft contains no operational deletion",
);

console.log("plan component room type atomic persistence harness: PASS");
