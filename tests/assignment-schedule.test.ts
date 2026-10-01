import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  loadAssignmentSchedule,
  readAllAssignmentPages,
} from "@/lib/teaching-assignments/assignment-schedule";
import { summarizeInstructorAttendanceDays } from "@/lib/teaching-assignments/assignment-row-days";

type Row = Record<string, unknown>;
function fixture(tables: Record<string, Row[]>, cap = 1000, failTable = "") {
  const reads: {
    table: string;
    filters: Record<string, unknown>;
    from: number;
  }[] = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const notNull: string[] = [];
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        not(key: string) {
          notNull.push(key);
          return query;
        },
        order() {
          return query;
        },
        range(from: number, to: number) {
          reads.push({ table, filters: { ...filters }, from });
          const rows = (tables[table] ?? []).filter(
            (row) =>
              Object.entries(filters).every(([key, value]) => row[key] === value) &&
              notNull.every((key) => row[key] != null),
          );
          return Promise.resolve({
            data: rows.slice(from, Math.min(to + 1, from + cap)),
            count: rows.length,
            error: table === failTable ? new Error("read failed") : null,
          });
        },
      };
      return query;
    },
  };
  return {
    client: client as unknown as Parameters<typeof loadAssignmentSchedule>[0],
    reads,
  };
}
const version = (id: string) =>
  ({ id, name: id, status: "draft", academic_term_id: "term" }) as const;
const assignment = (id: string, college = "c", active = true) => ({
  id,
  college_id: college,
  is_active: active,
});
const session = (v: string, id: string, day: number, college = "c") => ({
  schedule_version_id: v,
  delivery_group_id: id,
  teaching_assignment_id: id,
  day_of_week: day,
  college_id: college,
});

describe("complete assignment schedule reads", () => {
  it("finds all six current lectures despite more than 1000 historical sessions", async () => {
    const days = [6, 1, 2, 2, 3, 3];
    const db = fixture({
      teaching_assignments: days.map((_, i) => assignment(`g${i}`)),
      schedule_sessions: [
        ...Array.from({ length: 1500 }, () => session("old", "g0", 0)),
        ...days.map((day, i) => session("new", `g${i}`, day)),
      ],
    });
    const result = await loadAssignmentSchedule(db.client, "c", [version("new"), version("old")]);
    expect(result.version?.id).toBe("new");
    expect(result.days.size).toBe(6);
    const summary = summarizeInstructorAttendanceDays(
      days.map((_, i) => ({
        delivery_group_id: `g${i}`,
        instructors: [{ instructor_name: "محاضر تجريبي" }],
      })),
      "تجريبي",
      result.days,
    );
    expect(summary.totalDays).toBe(4);
    expect(
      db.reads
        .filter((r) => r.table === "schedule_sessions")
        .every((r) => r.filters.schedule_version_id === "new"),
    ).toBe(true);
  });

  it("paginates both assignments and a large selected version even under a smaller server cap", async () => {
    const db = fixture(
      {
        teaching_assignments: Array.from({ length: 1105 }, (_, i) => assignment(`g${i}`)),
        schedule_sessions: Array.from({ length: 1105 }, (_, i) => session("new", `g${i}`, i % 7)),
      },
      75,
    );
    const result = await loadAssignmentSchedule(db.client, "c", [version("new")]);
    expect(result.days.size).toBe(1105);
    expect(result.days.has("g1104")).toBe(true);
    expect(db.reads.some((r) => r.table === "teaching_assignments" && r.from > 1000)).toBe(true);
  });

  it("skips empty or inactive-only drafts and isolates the college", async () => {
    const db = fixture({
      teaching_assignments: [
        assignment("inactive", "c", false),
        assignment("active"),
        assignment("foreign", "other"),
      ],
      schedule_sessions: [
        session("empty", "inactive", 0),
        session("old", "active", 6),
        session("old", "foreign", 1, "other"),
      ],
    });
    const result = await loadAssignmentSchedule(db.client, "c", [version("empty"), version("old")]);
    expect(result.version?.id).toBe("old");
    expect([...result.days.keys()]).toEqual(["active"]);
    expect(db.reads.every((r) => r.filters.college_id === "c")).toBe(true);
  });

  it("returns a confirmed empty result when no eligible version is populated", async () => {
    const db = fixture({ teaching_assignments: [], schedule_sessions: [] });
    const result = await loadAssignmentSchedule(db.client, "c", [version("empty")]);
    expect(result.version).toBeNull();
    expect(result.days.size).toBe(0);
  });

  it("propagates read failures instead of claiming sessions are unscheduled", async () => {
    for (const table of ["teaching_assignments", "schedule_sessions"]) {
      const db = fixture(
        { teaching_assignments: [assignment("g")], schedule_sessions: [] },
        1000,
        table,
      );
      await expect(loadAssignmentSchedule(db.client, "c", [version("v")])).rejects.toThrow(
        "read failed",
      );
    }
  });

  it("rejects an incomplete later page and missing counts", async () => {
    await expect(
      readAllAssignmentPages(async (from) => ({
        data: from === 0 ? [1] : [],
        count: 2,
        error: null,
      })),
    ).rejects.toThrow();
    await expect(
      readAllAssignmentPages(async () => ({
        data: [],
        count: null,
        error: null,
      })),
    ).rejects.toThrow();
  });

  it("scopes the UI cache by term and displays errors and the chosen version", () => {
    const source = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");
    expect(source).toContain(
      '["teaching-assignment-row-days", active?.id, termId, viewVersion?.id ?? null]',
    );
    expect(source).toContain("termId: termId || null");
    expect(source).toContain('refetchOnMount: "always"');
    expect(source).toContain('data-testid="ta-v2-schedule-source"');
    expect(source).toContain("scheduleQuery.data.version.name");
    expect(source).toContain("scheduleQuery.isError");
    expect(source).toContain('"تعذر التحميل"');
    expect(source.replace(/\s+/g, " ")).toContain('scheduleUnavailable ? "—"');
  });
});
