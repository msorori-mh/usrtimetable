/**
 * Room import type normalization harness — pure logic, no DB writes.
 */
import {
  resolveRoomTypeFields,
  CANONICAL_ROOM_TYPES,
} from "../../src/lib/excel-import/room-type-normalize";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  // A. both blank → FAIL (no silent lecture_hall default)
  {
    const r = resolveRoomTypeFields(null, null);
    assert(!r.ok && r.errorCode === "missing_room_type", "A blank/blank rejected");
    assert(r.message.includes("نوع القاعة مطلوب"), "A arabic required message");
  }
  {
    const r = resolveRoomTypeFields("", "");
    assert(!r.ok && r.errorCode === "missing_room_type", "A empty strings rejected");
  }

  // B. canonical only
  {
    const r = resolveRoomTypeFields("lecture_hall", null);
    assert(r.ok && r.roomType === "lecture_hall", "B lecture_hall");
  }

  // C. LEC alias
  {
    const r = resolveRoomTypeFields(null, "LEC");
    assert(r.ok && r.roomType === "lecture_hall", "C LEC→lecture_hall");
  }

  // D. LAB alias
  {
    const r = resolveRoomTypeFields("", "LAB");
    assert(r.ok && r.roomType === "computer_lab", "D LAB→computer_lab");
  }

  // E. unknown canonical field
  {
    const r = resolveRoomTypeFields("XYZ", null);
    assert(!r.ok && r.errorCode === "unknown_room_type", "E unknown XYZ");
    assert(r.message.includes("غير معروف"), "E arabic");
    for (const t of CANONICAL_ROOM_TYPES) {
      assert(r.message.includes(t), `E lists ${t}`);
    }
  }

  // F. conflict
  {
    const r = resolveRoomTypeFields("network_lab", "LEC");
    assert(!r.ok && r.errorCode === "conflicting_room_type", "F conflict");
    assert(r.message.includes("تعارض"), "F arabic conflict message");
  }

  // network_lab alone
  {
    const r = resolveRoomTypeFields("network_lab", null);
    assert(r.ok && r.roomType === "network_lab", "network_lab");
  }

  // case normalization
  for (const code of ["lec", "Lec", "LEC"]) {
    const r = resolveRoomTypeFields(null, code);
    assert(r.ok && r.roomType === "lecture_hall", `case ${code}`);
  }

  // unknown code
  {
    const r = resolveRoomTypeFields(null, "XYZ");
    assert(!r.ok && r.errorCode === "unknown_room_type", "unknown code");
  }

  // compatible both
  {
    const r = resolveRoomTypeFields("lecture_hall", "LEC");
    assert(r.ok && r.roomType === "lecture_hall" && r.source === "both", "compatible both");
  }

  // do not collapse specific labs to computer_lab
  {
    const r = resolveRoomTypeFields("cybersecurity_lab", null);
    assert(r.ok && r.roomType === "cybersecurity_lab", "keep cybersecurity_lab");
  }

  // specialized labs preserved
  for (const t of [
    "network_lab",
    "cybersecurity_lab",
    "electronics_lab",
    "workshop",
    "seminar_room",
  ] as const) {
    const r = resolveRoomTypeFields(t, null);
    assert(r.ok && r.roomType === t, `preserve ${t}`);
  }

  assert(CANONICAL_ROOM_TYPES.includes("lecture_hall"), "internal key lecture_hall");
  console.log("PASS room-import-normalize.harness.ts");
}

run();
