/**
 * SUPERSEDED_BY_OWNER_DATA_POLICY
 * Historical offline simulation only. Do not use for production inventory,
 * operating hours, or enrollment-driven splits. Exits without applying anything.
 */
console.error(
  "SUPERSEDED_BY_OWNER_DATA_POLICY: simulation disabled - experimental enrollment/inventory assumptions revoked.",
);
process.exit(2);

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSubgroupPlansForSplit,
  candidateSlots,
  DEFAULT_SCHEDULER_CONFIG,
  pickRoom,
  scanConflicts,
  scheduleChildSession,
  timeToMinutes,
} from "../src/lib/schedule-builder/subgroup-auto-scheduler.ts";
import { ORIGINAL_SESSION_STRATEGY } from "../src/lib/schedule-builder/section-subgroups.ts";

function stableUuid(seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(
  root,
  "implementation-reports/phase-6-subgroup-data-model-and-auto-scheduling-implementation-01",
);

function parse(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function readCsv(rel) {
  const text = fs.readFileSync(path.join(root, rel), "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = parse(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parse(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => csvEscape(r[c])).join(","));
  }
  fs.writeFileSync(path.join(outDir, file), lines.join("\n") + "\n", "utf8");
}

function stableChildId(parentId, ordinal) {
  return stableUuid(`child:${parentId}:${ordinal}`);
}

function stableSubgroupId(sectionId, ordinal, parentSessionId) {
  return stableUuid(`subgroup:${sectionId}:${ordinal}:${parentSessionId}`);
}

fs.mkdirSync(outDir, { recursive: true });

const rooms = readCsv(
  "implementation-reports/phase-6-session-level-room-remap-auth-enrichment-01/current-rooms-inventory.csv",
).map((r) => ({
  id: r.room_id,
  code: r.code,
  room_type: r.room_type,
  capacity: Number(r.capacity),
}));

const sessions = readCsv(
  "implementation-reports/phase-6-session-level-room-remap-auth-enrichment-01/enriched-draft-sessions.csv",
);
const decisions = readCsv(
  "implementation-reports/phase-6-final-owner-decisions-and-write-prep-01/final-owner-policy-decisions.approved.csv",
);
const taFixes = readCsv(
  "implementation-reports/phase-6-final-owner-decisions-and-write-prep-01/ta-required-room-type-fixes.csv",
);

const decisionBySession = new Map(decisions.map((d) => [d.schedule_session_id, d]));
const taTargetBySession = new Map();
for (const row of taFixes) {
  const target = row.target_required_room_type;
  for (const sid of String(row.affected_session_ids).split("|").filter(Boolean)) {
    taTargetBySession.set(sid, target);
  }
}

const cfg = { ...DEFAULT_SCHEDULER_CONFIG };

// Resolve effective required room type after TA fixes
function effectiveRoomType(s) {
  if (taTargetBySession.has(s.schedule_session_id)) {
    return taTargetBySession.get(s.schedule_session_id);
  }
  const d = decisionBySession.get(s.schedule_session_id);
  if (d?.owner_decision === "FIX_TA_REQUIRED_ROOM_TYPE") {
    // Infer from session_type
    return s.session_type === "lab" ? "computer_lab" : "lecture_hall";
  }
  if (s.required_room_type === "NEEDS_REVIEW_REQUIRED_ROOM_TYPE_CONFLICT") {
    return s.session_inferred_room_type || (s.session_type === "lab" ? "computer_lab" : "lecture_hall");
  }
  return s.required_room_type || s.session_inferred_room_type || "lecture_hall";
}

const splitDecisions = new Set(["APPROVE_SPLIT_SECTION_GROUPS", "APPROVE_MULTI_GROUP_SPLIT"]);
const exceptionSessions = new Set(
  decisions
    .filter((d) => d.owner_decision === "APPROVE_OVER_CAPACITY_EXCEPTION")
    .map((d) => d.schedule_session_id),
);

const subgroupCreation = [];
const sessionSchedule = [];
const roomAllocation = [];
const incomplete = [];

/** Occupancy per version */
const occupancyByVersion = new Map();

function getOcc(versionId) {
  if (!occupancyByVersion.has(versionId)) occupancyByVersion.set(versionId, []);
  return occupancyByVersion.get(versionId);
}

// Sort sessions for determinism
const sorted = [...sessions].sort((a, b) =>
  a.schedule_version_id.localeCompare(b.schedule_version_id) ||
  a.schedule_session_id.localeCompare(b.schedule_session_id),
);

// Pass 1: seed non-split / exception sessions at original times (room TBD), mark split parents retired
for (const s of sorted) {
  const dec = decisionBySession.get(s.schedule_session_id);
  const isSplit = dec && splitDecisions.has(dec.owner_decision);
  const occ = getOcc(s.schedule_version_id);
  if (isSplit) {
    occ.push({
      id: s.schedule_session_id,
      instructor_id: s.instructor_id,
      room_id: null,
      section_id: s.section_id || null,
      section_subgroup_id: null,
      study_system: s.study_system,
      day_of_week: Number(s.day_of_week),
      start_time: s.start_time,
      end_time: s.end_time,
      expected_students: Number(s.expected_capacity || 0),
      required_room_type: effectiveRoomType(s),
      replaced_by_split: true,
    });
    continue;
  }

  // Place non-split at original slot if possible; else search
  const required = effectiveRoomType(s);
  const students = Number(s.expected_capacity || 0);
  const duration =
    timeToMinutes(s.end_time) - timeToMinutes(s.start_time) || Number(s.duration_minutes) || 120;
  const base = {
    id: s.schedule_session_id,
    instructor_id: s.instructor_id,
    room_id: null,
    section_id: s.section_id || null,
    section_subgroup_id: null,
    study_system: s.study_system,
    day_of_week: Number(s.day_of_week),
    start_time: s.start_time,
    end_time: s.end_time,
    expected_students: students,
    required_room_type: required,
  };
  const peers = occ.filter((o) => !o.replaced_by_split);
  let placed = null;
  const trySlots = [
    { day_of_week: Number(s.day_of_week), start_time: s.start_time, end_time: s.end_time },
    ...candidateSlots(Number(s.day_of_week), s.start_time, duration, cfg),
  ];
  const seen = new Set();
  for (const slot of trySlots) {
    const k = `${slot.day_of_week}|${slot.start_time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const trial = { ...base, day_of_week: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time };
    const overlaps = (p) =>
      p.day_of_week === trial.day_of_week &&
      timeToMinutes(trial.start_time) < timeToMinutes(p.end_time) &&
      timeToMinutes(p.start_time) < timeToMinutes(trial.end_time);
    const instructorBusy = peers.some((p) => p.instructor_id === trial.instructor_id && overlaps(p));
    if (instructorBusy) continue;
    const sectionBusy = peers.some((p) => {
      if (!trial.section_id || p.section_id !== trial.section_id || !overlaps(p)) return false;
      if (trial.study_system !== p.study_system && trial.study_system !== "both" && p.study_system !== "both") {
        return false;
      }
      const a = trial.section_subgroup_id ?? null;
      const b = p.section_subgroup_id ?? null;
      return a === null || b === null || a === b;
    });
    if (sectionBusy) continue;
    const room = pickRoom(rooms, required, students, trial, peers, cfg);
    if (!room) continue;
    placed = { ...trial, room_id: room.id, room_code: room.code };
    break;
  }
  if (placed) {
    occ.push(placed);
    sessionSchedule.push({
      resulting_session_id: s.schedule_session_id,
      source_schedule_session_id: s.schedule_session_id,
      role: "standalone",
      section_subgroup_id: "",
      subgroup_code: "",
      ordinal: "",
      day_of_week: placed.day_of_week,
      start_time: placed.start_time,
      end_time: placed.end_time,
      room_id: placed.room_id,
      room_code: placed.room_code,
      expected_students: students,
      required_room_type: required,
      study_system: s.study_system,
      schedule_status: "SCHEDULED",
      original_session_strategy: "",
      owner_decision: dec?.owner_decision || "REMAP_ONLY",
    });
    roomAllocation.push({
      resulting_session_id: s.schedule_session_id,
      source_schedule_session_id: s.schedule_session_id,
      subgroup_code: "",
      required_room_type: required,
      expected_students: students,
      room_id: placed.room_id,
      room_code: placed.room_code,
      room_capacity: rooms.find((r) => r.id === placed.room_id)?.capacity ?? "",
      capacity_valid:
        students <= (rooms.find((r) => r.id === placed.room_id)?.capacity ?? 0) + 5 ? "yes" : "no",
      type_valid: "yes",
      orphan_cleared: "yes",
    });
  } else {
    incomplete.push({
      session_id: s.schedule_session_id,
      role: "standalone",
      reason: "NO_VALID_SLOT",
      schedule_version_id: s.schedule_version_id,
    });
    sessionSchedule.push({
      resulting_session_id: s.schedule_session_id,
      source_schedule_session_id: s.schedule_session_id,
      role: "standalone",
      section_subgroup_id: "",
      subgroup_code: "",
      ordinal: "",
      day_of_week: "",
      start_time: "",
      end_time: "",
      room_id: "",
      room_code: "",
      expected_students: students,
      required_room_type: required,
      study_system: s.study_system,
      schedule_status: "UNSCHEDULED",
      original_session_strategy: "",
      owner_decision: dec?.owner_decision || "REMAP_ONLY",
    });
  }
}

// Pass 2: create subgroups + schedule children for splits (deterministic order)
const splitSources = sorted.filter((s) => {
  const d = decisionBySession.get(s.schedule_session_id);
  return d && splitDecisions.has(d.owner_decision);
});

for (const s of splitSources) {
  const dec = decisionBySession.get(s.schedule_session_id);
  const n = Number(dec.recommended_groups_count);
  const count = Number.isFinite(n) && n > 0 ? n : 2;
  const total = Number(dec.expected_capacity || s.expected_capacity || 0);
  const roomCap = Number(dec.available_capacity || (effectiveRoomType(s) === "computer_lab" ? 30 : 60));
  const plan = buildSubgroupPlansForSplit(total, count);
  const duration =
    timeToMinutes(s.end_time) - timeToMinutes(s.start_time) || Number(s.duration_minutes) || 120;
  const required = effectiveRoomType(s);
  const occ = getOcc(s.schedule_version_id);

  // Parent audit row
  sessionSchedule.push({
    resulting_session_id: s.schedule_session_id,
    source_schedule_session_id: s.schedule_session_id,
    role: "parent_retired",
    section_subgroup_id: "",
    subgroup_code: "",
    ordinal: "",
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    room_id: "",
    room_code: "",
    expected_students: total,
    required_room_type: required,
    study_system: s.study_system,
    schedule_status: "REPLACED_BY_SPLIT",
    original_session_strategy: ORIGINAL_SESSION_STRATEGY,
    owner_decision: dec.owner_decision,
  });

  for (const row of plan) {
    const subgroupId = stableSubgroupId(s.section_id || s.course_id, row.ordinal, s.schedule_session_id);
    const childId = stableChildId(s.schedule_session_id, row.ordinal);
    subgroupCreation.push({
      section_subgroup_id: subgroupId,
      source_schedule_session_id: s.schedule_session_id,
      section_id: s.section_id,
      course_id: s.course_id,
      course_code: s.course_code,
      study_system: s.study_system,
      subgroup_code: row.subgroup_code,
      ordinal: row.ordinal,
      expected_students: row.expected_students,
      room_capacity_basis: roomCap,
      max_allowed: roomCap + 5,
      source_policy: dec.owner_decision,
      owner_approval_ref: "final-owner-policy-decisions.approved.csv",
      child_session_id: childId,
    });

    const result = scheduleChildSession(
      {
        childId,
        instructor_id: s.instructor_id,
        section_id: s.section_id || null,
        section_subgroup_id: subgroupId,
        study_system: s.study_system,
        expected_students: row.expected_students,
        required_room_type: required,
        duration_minutes: duration,
        original_day: Number(s.day_of_week),
        original_start: s.start_time,
      },
      rooms,
      occ,
      cfg,
    );

    if (result.ok) {
      sessionSchedule.push({
        resulting_session_id: childId,
        source_schedule_session_id: s.schedule_session_id,
        role: "child",
        section_subgroup_id: subgroupId,
        subgroup_code: row.subgroup_code,
        ordinal: row.ordinal,
        day_of_week: result.day_of_week,
        start_time: result.start_time,
        end_time: result.end_time,
        room_id: result.room_id,
        room_code: result.room_code,
        expected_students: row.expected_students,
        required_room_type: required,
        study_system: s.study_system,
        schedule_status: "SCHEDULED",
        original_session_strategy: ORIGINAL_SESSION_STRATEGY,
        owner_decision: dec.owner_decision,
      });
      roomAllocation.push({
        resulting_session_id: childId,
        source_schedule_session_id: s.schedule_session_id,
        subgroup_code: row.subgroup_code,
        required_room_type: required,
        expected_students: row.expected_students,
        room_id: result.room_id,
        room_code: result.room_code,
        room_capacity: rooms.find((r) => r.id === result.room_id)?.capacity ?? "",
        capacity_valid: "yes",
        type_valid: "yes",
        orphan_cleared: "yes",
      });
    } else {
      incomplete.push({
        session_id: childId,
        source_schedule_session_id: s.schedule_session_id,
        role: "child",
        subgroup_code: row.subgroup_code,
        reason: result.reason,
        schedule_version_id: s.schedule_version_id,
      });
      sessionSchedule.push({
        resulting_session_id: childId,
        source_schedule_session_id: s.schedule_session_id,
        role: "child",
        section_subgroup_id: subgroupId,
        subgroup_code: row.subgroup_code,
        ordinal: row.ordinal,
        day_of_week: "",
        start_time: "",
        end_time: "",
        room_id: "",
        room_code: "",
        expected_students: row.expected_students,
        required_room_type: required,
        study_system: s.study_system,
        schedule_status: "UNSCHEDULED",
        original_session_strategy: ORIGINAL_SESSION_STRATEGY,
        owner_decision: dec.owner_decision,
      });
    }
  }
}

// Conflicts are scoped per schedule_version (versions share room catalog but not the grid).
const conflictRows = [];
for (const [versionId, occ] of occupancyByVersion.entries()) {
  for (const c of scanConflicts(occ)) {
    conflictRows.push({
      conflict_code: c.code,
      session_id: c.session_id,
      related_session_id: c.related_session_id,
      schedule_version_id: versionId,
      introduced_by_simulation: "yes",
    });
  }
}
const conflicts = conflictRows;

const scheduledChildren = sessionSchedule.filter((r) => r.role === "child" && r.schedule_status === "SCHEDULED");
const unscheduledChildren = sessionSchedule.filter((r) => r.role === "child" && r.schedule_status === "UNSCHEDULED");
const scheduledStandalone = sessionSchedule.filter((r) => r.role === "standalone" && r.schedule_status === "SCHEDULED");
const unscheduledStandalone = sessionSchedule.filter((r) => r.role === "standalone" && r.schedule_status === "UNSCHEDULED");

const orphanRemaining = roomAllocation.filter((r) => !rooms.some((x) => x.id === r.room_id)).length;

writeCsv("subgroup-creation-plan.csv", subgroupCreation, [
  "section_subgroup_id",
  "source_schedule_session_id",
  "section_id",
  "course_id",
  "course_code",
  "study_system",
  "subgroup_code",
  "ordinal",
  "expected_students",
  "room_capacity_basis",
  "max_allowed",
  "source_policy",
  "owner_approval_ref",
  "child_session_id",
]);

writeCsv("subgroup-session-schedule-plan.csv", sessionSchedule, [
  "resulting_session_id",
  "source_schedule_session_id",
  "role",
  "section_subgroup_id",
  "subgroup_code",
  "ordinal",
  "day_of_week",
  "start_time",
  "end_time",
  "room_id",
  "room_code",
  "expected_students",
  "required_room_type",
  "study_system",
  "schedule_status",
  "original_session_strategy",
  "owner_decision",
]);

writeCsv("subgroup-room-allocation-plan.csv", roomAllocation, [
  "resulting_session_id",
  "source_schedule_session_id",
  "subgroup_code",
  "required_room_type",
  "expected_students",
  "room_id",
  "room_code",
  "room_capacity",
  "capacity_valid",
  "type_valid",
  "orphan_cleared",
]);

writeCsv("subgroup-conflict-simulation.csv", conflictRows.length ? conflictRows : [{
  conflict_code: "none",
  session_id: "",
  related_session_id: "",
  schedule_version_id: "",
  introduced_by_simulation: "no",
}], [
  "conflict_code",
  "session_id",
  "related_session_id",
  "schedule_version_id",
  "introduced_by_simulation",
]);

writeCsv("unscheduled-sessions.csv", incomplete, [
  "session_id",
  "source_schedule_session_id",
  "role",
  "subgroup_code",
  "reason",
  "schedule_version_id",
]);

const summary = {
  strategy: ORIGINAL_SESSION_STRATEGY,
  subgroups_planned: subgroupCreation.length,
  split_parents: splitSources.length,
  child_sessions: scheduledChildren.length + unscheduledChildren.length,
  child_scheduled: scheduledChildren.length,
  child_unscheduled: unscheduledChildren.length,
  standalone_scheduled: scheduledStandalone.length,
  standalone_unscheduled: unscheduledStandalone.length,
  exception_sessions: exceptionSessions.size,
  ta_fixes: taFixes.length,
  new_conflicts: conflicts.length,
  orphan_remaining_in_allocations: orphanRemaining,
  decision:
    unscheduledChildren.length > 0 || unscheduledStandalone.length > 0
      ? "HOLD — SUBGROUP_AUTO_SCHEDULING_INCOMPLETE"
      : conflicts.length > 0
        ? "HOLD — SUBGROUP_AUTO_SCHEDULING_INCOMPLETE"
        : "PASS — SUBGROUP_MODEL_AND_MIGRATION_READY",
};

fs.writeFileSync(path.join(outDir, "simulation-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
