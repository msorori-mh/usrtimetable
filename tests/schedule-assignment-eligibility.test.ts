import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSessionAssignmentIssues } from "@/lib/schedule-versions/assignment-integrity";

const fixture = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  assignmentError: null as { message: string } | null,
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: fixture.rpc,
    from: (table: string) => {
      const result = () => ({
        data:
          table === "schedule_sessions"
            ? fixture.sessions
            : table === "teaching_assignments"
              ? fixture.assignments
              : table === "schedule_quality_runs"
                ? { total_score: 100, soft_conflicts_count: 0 }
                : null,
        error: table === "teaching_assignments" ? fixture.assignmentError : null,
      });
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  },
}));
vi.mock("@/lib/conflict-engine/validator", () => ({
  validateProposed: async () => ({
    conflicts: [],
    totalHardConflicts: 0,
    approvedHardConflicts: 0,
    unapprovedHardConflicts: 0,
  }),
}));
vi.mock("@/lib/conflict-engine/exceptions", () => ({
  loadApprovedExceptions: async () => [],
  summarizeConflictExceptions: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import {
  evaluateEligibility,
  transitionVersion,
  validateGate,
} from "@/lib/schedule-versions/lifecycle";

beforeEach(() => {
  fixture.sessions = [
    { id: "session", teaching_assignment_id: "old", instructor_id: "old-teacher" },
  ];
  fixture.assignments = [
    { id: "old", instructor_id: "old-teacher", is_active: false },
    { id: "new", instructor_id: "new-teacher", is_active: true },
  ];
  fixture.assignmentError = null;
  fixture.rpc.mockReset();
});

describe("session assignment eligibility", () => {
  it("rejects an inactive linked assignment despite zero conflicts, full hours and an active replacement", async () => {
    const eligibility = await evaluateEligibility({
      collegeId: "college",
      scheduleVersionId: "draft",
    });
    expect(eligibility.unapprovedHardConflicts).toBe(0);
    expect(eligibility.qualityScore).toBe(100);
    expect(eligibility.ok).toBe(false);
    expect(eligibility.assignmentIntegrityErrors).toHaveLength(1);
    expect(eligibility.assignmentIntegrityErrors![0]).toContain("1");
    for (const target of ["review", "approved", "published"] as const) {
      expect(validateGate(target, eligibility)).toEqual(eligibility.assignmentIntegrityErrors);
    }
    // These are repair/history paths, not new approvals.
    expect(validateGate("draft", eligibility, "review")).toEqual([]);
    expect(validateGate("review", eligibility, "approved")).toEqual([]);
    expect(validateGate("archived", eligibility, "published")).toEqual([]);
  });

  it("fails closed when assignment rows cannot be read", async () => {
    fixture.assignmentError = { message: "assignment read denied" };
    await expect(
      evaluateEligibility({ collegeId: "college", scheduleVersionId: "draft" }),
    ).rejects.toEqual(fixture.assignmentError);
  });

  it("permits a valid link without substituting the operational replacement", async () => {
    fixture.assignments[0].is_active = true;
    const eligibility = await evaluateEligibility({
      collegeId: "college",
      scheduleVersionId: "draft",
    });
    expect(eligibility.ok).toBe(true);
    expect(eligibility.assignmentIntegrityErrors).toEqual([]);
    expect(validateGate("published", eligibility)).toEqual([]);
  });

  it("identifies missing and mismatched links while preserving legacy and retired split handling", () => {
    const issues = findSessionAssignmentIssues(
      [
        { id: "missing", teaching_assignment_id: "gone", instructor_id: "old-teacher" },
        { id: "mismatched", teaching_assignment_id: "new", instructor_id: "old-teacher" },
        { id: "legacy", teaching_assignment_id: null, instructor_id: "old-teacher" },
        {
          id: "split",
          teaching_assignment_id: "gone",
          instructor_id: "old-teacher",
          replaced_by_split: true,
        },
      ],
      [{ id: "new", instructor_id: "new-teacher", is_active: true }],
    );
    expect(issues.map((issue) => [issue.sessionId, issue.code])).toEqual([
      ["missing", "missing_assignment"],
      ["mismatched", "instructor_mismatch"],
    ]);
  });

  it("explains the server blocker in Arabic and continues to use the authenticated lifecycle RPC", async () => {
    fixture.rpc.mockResolvedValue({
      error: { message: "PUBLISH_BLOCKER:SCHEDULE_SESSION_ASSIGNMENT_INTEGRITY" },
    });
    await expect(
      transitionVersion({
        collegeId: "college",
        scheduleVersionId: "review",
        from: "review",
        to: "approved",
      }),
    ).rejects.toThrow("جلسات مرتبطة بإسنادات ملغاة");
    expect(fixture.rpc).toHaveBeenCalledWith("transition_schedule_version", {
      p_college_id: "college",
      p_schedule_version_id: "review",
      p_expected_status: "review",
      p_target_status: "approved",
      p_notes: undefined,
    });
  });
});
