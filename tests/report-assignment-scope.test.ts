import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: db }));
vi.mock("@/lib/academic-delivery/shared-lectures", () => ({
  fetchSharedLectures: async () => [],
}));
vi.mock("@/lib/academic-delivery/version-group-catalog", () => ({
  fetchVersionGroupCatalog: async () => [
    {
      id: "group",
      cohort_id: "cohort",
      component_id: "component",
      plan_course_id: "plan-course",
      active: true,
      is_obsolete: false,
      group_code: "G1",
      group_number: 1,
      expected_students: 30,
    },
  ],
}));

import { fetchReportAssignmentRefs } from "@/lib/reports/queries/assignment-queries";
import { fetchCohortDeliveryGroupCatalog } from "@/lib/reports/queries/delivery-group-coverage-queries";

const instructor = (id: string, name: string, hours: number | null) => ({
  assignment_id: `assignment-${id}`,
  instructor_id: id,
  instructor_name: name,
  assigned_component_hours: hours,
  is_active: true,
  updated_at: "2026-10-02T00:00:00Z",
});
const workspace = (instructors: ReturnType<typeof instructor>[], versionId?: string) => ({
  ok: true,
  college_id: "college",
  can_manage: false,
  ...(versionId ? { schedule_version_id: versionId } : {}),
  rows: [{ college_id: "college", delivery_group_id: "group", instructors }],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "list_teaching_assignment_workspace_for_version") {
      return {
        data: workspace(
          args.p_schedule_version_id === "published"
            ? [instructor("old", "المحاضر التاريخي", 2)]
            : [instructor("new", "المحاضر الجديد", 1), instructor("peer", "محاضر زائر", 2)],
          String(args.p_schedule_version_id),
        ),
        error: null,
      };
    }
    if (name === "list_teaching_assignment_workspace") {
      return { data: workspace([instructor("operational", "الإسناد التشغيلي", 3)]), error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  db.from.mockImplementation((table: string) => {
    const tables: Record<string, Record<string, unknown>[]> = {
      plan_course_components: [
        { id: "component", component_type: "theory", weekly_contact_hours: 3 },
      ],
      plan_courses: [{ id: "plan-course", course_id: "course" }],
      courses: [{ id: "course", name: "المقرر", code: "C101" }],
    };
    if (!(table in tables)) throw new Error(`Unscoped report read: ${table}`);
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async () => ({ data: tables[table], error: null }),
    };
    return query;
  });
});

describe("report assignments belong to the selected version", () => {
  it("separates active historical scoped assignments from draft replacements and co-teachers", async () => {
    const params = { collegeId: "college", cohortIds: ["cohort"] };
    const published = await fetchCohortDeliveryGroupCatalog({ ...params, versionId: "published" });
    const draft = await fetchCohortDeliveryGroupCatalog({ ...params, versionId: "draft" });
    expect(published[0].instructorName).toBe("المحاضر التاريخي");
    expect(draft[0].instructorName).toBe("المحاضر الجديد، محاضر زائر");
    expect(published[0].requiredHours).toBe(3);
    expect(draft[0].requiredHours).toBe(3);
    expect(
      db.rpc.mock.calls.every(
        ([name]) => name === "list_teaching_assignment_workspace_for_version",
      ),
    ).toBe(true);
    // Lecturer names already resolve visiting faculty in the authorized read model.
    expect(db.from.mock.calls.map(([table]) => table)).not.toContain("teaching_assignments");
    expect(db.from.mock.calls.map(([table]) => table)).not.toContain("schedule_sessions");
  });

  it("reads co-teaching credit from the same version and excludes unrelated groups", async () => {
    const scoped = await fetchReportAssignmentRefs({
      collegeId: "college",
      versionId: "draft",
      groupIds: ["group"],
    });
    expect(
      scoped.map(({ instructor_id, assigned_component_hours }) => [
        instructor_id,
        assigned_component_hours,
      ]),
    ).toEqual([
      ["new", 1],
      ["peer", 2],
    ]);
    const old = await fetchReportAssignmentRefs({
      collegeId: "college",
      versionId: "published",
      groupIds: ["group"],
    });
    expect(
      old.map(({ instructor_id, assigned_component_hours }) => [
        instructor_id,
        assigned_component_hours,
      ]),
    ).toEqual([["old", 2]]);
    expect(
      await fetchReportAssignmentRefs({
        collegeId: "college",
        versionId: "draft",
        groupIds: ["other-group"],
      }),
    ).toEqual([]);
  });

  it("uses operational assignments only when the caller has no selected version", async () => {
    const refs = await fetchReportAssignmentRefs({ collegeId: "college", groupIds: ["group"] });
    expect(refs[0].instructor_id).toBe("operational");
    expect(db.rpc.mock.calls[0][0]).toBe("list_teaching_assignment_workspace");
    expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("p_schedule_version_id");
  });

  it("propagates a denied version read instead of substituting operational lecturers", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "SCHEDULE_VERSION_NOT_IN_COLLEGE" } });
    await expect(
      fetchReportAssignmentRefs({
        collegeId: "college",
        versionId: "wrong-college-version",
        groupIds: ["group"],
      }),
    ).rejects.toThrow("SCHEDULE_VERSION_NOT_IN_COLLEGE");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls[0][0]).toBe("list_teaching_assignment_workspace_for_version");
  });

  it("rejects an inconsistent college response and preserves groups with no lecturer", async () => {
    db.rpc.mockResolvedValueOnce({
      data: { ...workspace([], "draft"), college_id: "other-college" },
      error: null,
    });
    await expect(
      fetchReportAssignmentRefs({ collegeId: "college", versionId: "draft", groupIds: ["group"] }),
    ).rejects.toThrow("نطاق التقرير");
    db.rpc.mockResolvedValueOnce({ data: workspace([], "draft"), error: null });
    const rows = await fetchCohortDeliveryGroupCatalog({
      collegeId: "college",
      versionId: "draft",
      cohortIds: ["cohort"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].instructorName).toBeNull();
    expect(rows[0].requiredHours).toBe(3);
  });

  it.each([undefined, "another-version"])(
    "rejects a missing or mismatched version echo (%s) without another source read",
    async (echo) => {
      db.rpc.mockResolvedValueOnce({ data: workspace([], echo), error: null });
      await expect(
        fetchReportAssignmentRefs({
          collegeId: "college",
          versionId: "draft",
          groupIds: ["group"],
        }),
      ).rejects.toThrow("نسخة التقرير");
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves inactive historical lecturers without credited hours instead of borrowing replacement hours", async () => {
    // The live effective-assignment model omits inactive TAs for every status.
    // A new operational assignment may remain on the group; it is a different
    // lecturer and must not be relabelled as the old lecturer in session data.
    db.rpc.mockResolvedValueOnce({
      data: workspace([instructor("new", "المحاضر الجديد", 3)], "published"),
      error: null,
    });
    const refs = await fetchReportAssignmentRefs({
      collegeId: "college",
      versionId: "published",
      groupIds: ["group"],
    });
    expect(refs.map((ref) => ref.instructor_id)).toEqual(["new"]);
    const historicalCredit =
      refs.find((ref) => ref.delivery_group_id === "group" && ref.instructor_id === "old")
        ?.assigned_component_hours ?? null;
    expect(historicalCredit).toBeNull();
    expect(db.from.mock.calls.map(([table]) => table)).not.toContain("schedule_sessions");
  });
});
