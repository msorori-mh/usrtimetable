import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assembleWorkspaceSessionRows } from "../src/lib/schedule-builder/session-hydrate";
import {
  selectContainsNestedCoursesEmbed,
  TIMETABLE_SESSION_SELECT,
  LEGACY_TIMETABLE_SESSION_SELECT,
  PUBLISHED_TIMETABLE_SELECT,
} from "../src/lib/reports/queries/session-queries";
import { mapRawToTimetableSession } from "../src/lib/reports/session-mappers";

const root = resolve(import.meta.dir, "..");

describe("timetable session course visibility (PGRST200)", () => {
  test("session selects never nest courses() under course_offerings", () => {
    expect(selectContainsNestedCoursesEmbed(TIMETABLE_SESSION_SELECT)).toBe(false);
    expect(selectContainsNestedCoursesEmbed(LEGACY_TIMETABLE_SESSION_SELECT)).toBe(false);
    expect(selectContainsNestedCoursesEmbed(PUBLISHED_TIMETABLE_SELECT)).toBe(false);
    expect(
      selectContainsNestedCoursesEmbed("course_offerings(program_id, courses(code, name))"),
    ).toBe(true);
  });

  test("source files avoid nested courses embeds on schedule session queries", () => {
    const timetable = readFileSync(
      resolve(root, "src/routes/_authenticated/timetable.$versionId.tsx"),
      "utf8",
    );
    const operational = readFileSync(
      resolve(root, "src/lib/reports/queries/operational-queries.ts"),
      "utf8",
    );
    const sessionQueries = readFileSync(
      resolve(root, "src/lib/reports/queries/session-queries.ts"),
      "utf8",
    );
    expect(timetable.includes("fetchHydratedVersionSessions")).toBe(true);
    expect(operational.includes("hydrateWorkspaceSessions")).toBe(true);
    expect(sessionQueries.includes("hydrateWorkspaceSessions")).toBe(true);
    // Live select string literals must not contain nested courses embeds.
    const selectLiterals = [
      ...sessionQueries.matchAll(/export const \w+_SELECT = `([\s\S]*?)` as const/g),
    ].map((m) => m[1]);
    for (const lit of selectLiterals) {
      expect(selectContainsNestedCoursesEmbed(lit)).toBe(false);
    }
    expect(timetable.includes("course_offerings(")).toBe(false);
    expect(operational.includes("course_offerings(")).toBe(false);
  });

  test("hydrate assembles 54 unique sessions and keeps missing-course fallback per row", () => {
    const flat = Array.from({ length: 54 }, (_, i) => ({
      id: `s-${i}`,
      day_of_week: i % 5,
      start_time: "08:00:00",
      end_time: "10:00:00",
      session_type: i % 2 === 0 ? "lecture" : "lab",
      study_system: i % 3 === 0 ? "parallel" : "regular",
      section_id: null,
      instructor_id: `inst-${i % 10}`,
      room_id: `room-${i % 8}`,
      updated_at: null,
      is_locked: false,
      course_offering_id: `off-${i}`,
      cohort_id: `coh-${i % 28}`,
      delivery_group_id: `dg-${i}`,
    }));

    const offerings = new Map(
      flat.map((s, i) => [
        s.course_offering_id,
        {
          id: s.course_offering_id,
          program_id: `prog-${i % 4}`,
          level_id: `lvl-${i % 14}`,
          course_id: i === 7 ? "missing-course" : `course-${i}`,
          expected_students: 30,
          enrollment_count_status: "verified",
          enrollment_count_updated_at: null,
        },
      ]),
    );
    const courses = new Map<
      string,
      { id: string; name: string | null; code: string | null; department_id: string | null }
    >();
    for (let i = 0; i < 54; i++) {
      if (i === 7) continue;
      courses.set(`course-${i}`, {
        id: `course-${i}`,
        name: `Course ${i}`,
        code: `C${String(i).padStart(3, "0")}`,
        department_id: "dept-1",
      });
    }

    const hydrated = assembleWorkspaceSessionRows(flat, {
      offerings,
      courses,
      departments: new Map([["dept-1", { id: "dept-1", name: "IT" }]]),
      programs: new Map([["prog-0", { id: "prog-0", name: "CS" }]]),
      levels: new Map([["lvl-0", { id: "lvl-0", name: "L1", level_number: 1 }]]),
      sections: new Map(),
      subgroups: new Map(),
      instructors: new Map(
        Array.from({ length: 10 }, (_, i) => [
          `inst-${i}`,
          { id: `inst-${i}`, full_name: `Instructor ${i}` },
        ]),
      ),
      rooms: new Map(
        Array.from({ length: 8 }, (_, i) => [
          `room-${i}`,
          { id: `room-${i}`, code: `Q${i}`, name: `Room ${i}` },
        ]),
      ),
    });

    expect(hydrated.length).toBe(54);
    expect(new Set(hydrated.map((s) => s.id)).size).toBe(54);
    expect(hydrated[7]?.course_offerings?.courses).toBeNull();
    expect(hydrated[0]?.course_offerings?.courses?.code).toBe("C000");

    const mappedMissing = mapRawToTimetableSession(hydrated[7]);
    expect(mappedMissing.course_code).toBe("—");
    expect(mappedMissing.course_name).toBe("مقرر غير متاح");

    const mappedOk = mapRawToTimetableSession(hydrated[0]);
    expect(mappedOk.course_code).toBe("C000");
    expect(mappedOk.instructor_name).toBe("Instructor 0");

    // Filters operate on hydrated fields
    const byProg = hydrated.filter((s) => s.course_offerings?.program_id === "prog-0");
    const bySystem = hydrated.filter((s) => s.study_system === "regular");
    const byInstr = hydrated.filter((s) => s.instructor_id === "inst-0");
    const byRoom = hydrated.filter((s) => s.room_id === "room-0");
    expect(byProg.length).toBeGreaterThan(0);
    expect(bySystem.length).toBeGreaterThan(0);
    expect(byInstr.length).toBeGreaterThan(0);
    expect(byRoom.length).toBeGreaterThan(0);
  });
});
