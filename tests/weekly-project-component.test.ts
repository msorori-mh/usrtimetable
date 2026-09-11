/**
 * Weekly regular project components (counts_toward_regular_load = true) are ordinary
 * timetabled classroom work; graduation-project supervision stays non-weekly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { calculateDeliveryGroupCount } from "@/lib/academic-delivery/delivery-groups";
import { computeInstructorWorkload, hoursForAssignment } from "@/lib/academic-delivery/workload";
import { requiredCadenceForComponent } from "@/lib/auto-scheduler/session-plan";

describe("weekly project component", () => {
  it("uses room capacity and no explicit group size", () => {
    const r = calculateDeliveryGroupCount({
      componentType: "project",
      studentCount: 120,
      weeklyContactHours: 2,
      countsTowardRegularLoad: true,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    expect(r.ok).toBe(true);
    if (r.ok && !("skipped" in r && r.skipped)) {
      expect(r.groupCount).toBe(2);
      expect(r.capacityUsed).toBe(60);
      expect(r.excludedFromStandardWorkload).toBe(false);
    }
  });

  it("keeps supervision semantics for graduation projects", () => {
    const r = calculateDeliveryGroupCount({
      componentType: "project",
      studentCount: 120,
      weeklyContactHours: 2,
      countsTowardRegularLoad: false,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_PROJECT_GROUP_SIZE");
  });

  it("counts weekly project hours as regular teaching load", () => {
    const h = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "project",
      weeklyContactHours: 2,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: true,
      coInstructorCount: 0,
    });
    expect(h).toEqual({ standard: 2, project: 0 });

    const supervision = hoursForAssignment({
      deliveryGroupId: "g2",
      componentType: "project",
      weeklyContactHours: 2,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: false,
      coInstructorCount: 0,
    });
    expect(supervision).toEqual({ standard: 0, project: 2 });
  });

  it("aggregates 2h theory + 2h weekly project as 4 regular hours", () => {
    const w = computeInstructorWorkload({
      academicRank: "assistant_professor",
      assignments: [
        {
          deliveryGroupId: "t",
          componentType: "theory",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "p",
          componentType: "project",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
    });
    expect(w.standardAssignedHours).toBe(4);
    expect(w.projectSupervisionHours).toBe(0);
  });

  it("derives one 2h session per component from a shared 2x2 lecture pattern", () => {
    const plan = {
      lectures_per_week: 2,
      lecture_session_duration: 2,
      labs_per_week: 0,
      lab_session_duration: 2,
    };
    expect(
      requiredCadenceForComponent({ componentType: "theory", assignedHours: 2, planCourse: plan }),
    ).toEqual({ durations: [2], source: "plan", noteAr: null });
    expect(
      requiredCadenceForComponent({ componentType: "project", assignedHours: 2, planCourse: plan }),
    ).toEqual({ durations: [2], source: "plan", noteAr: null });
    expect(
      requiredCadenceForComponent({ componentType: "theory", assignedHours: 4, planCourse: plan }),
    ).toEqual({ durations: [2, 2], source: "plan", noteAr: null });
  });

  it("still blocks hours that do not fit the plan session duration", () => {
    const r = requiredCadenceForComponent({
      componentType: "project",
      assignedHours: 3,
      planCourse: {
        lectures_per_week: 2,
        lecture_session_duration: 2,
        labs_per_week: 0,
        lab_session_duration: 2,
      },
    });
    expect(r.source).toBe("blocked");
    expect(r.durations).toEqual([]);
  });
});

describe("migration pin (source of truth)", () => {
  const dir = "supabase/migrations";
  const functions = readFileSync(
    `${dir}/20260911214530_a6ae073b-3882-417f-8b63-b0a6631c2e2d.sql`,
    "utf8",
  );
  const state = readFileSync(
    `${dir}/20260911215443_5895332c-8869-416c-9833-98b32fd88605.sql`,
    "utf8",
  );

  it("keeps the weekly/supervision split conditional, never all projects weekly", () => {
    expect(functions).toContain("('project', v_project, v_project>0 OR v_grad, NOT v_grad,");
    expect(functions).toContain(
      "COALESCE(pcc.counts_toward_regular_load, true) = false THEN ''PROJECT_NON_WEEKLY''",
    );
    expect(functions).toContain("AND COALESCE(r.counts_toward_regular_load, false) = false THEN");
    // the patch rewrites the exclusion flag to depend on the regular-load flag only
    expect(functions).toContain(
      "v_excluded := (COALESCE(r.counts_toward_regular_load, true) = false);",
    );
  });

  it("reports an obsolete group only when it becomes obsolete in this run", () => {
    expect(functions).toContain(
      "IF COALESCE(v_row.is_obsolete, false) THEN\\n        CONTINUE;\\n      END IF;",
    );
  });

  it("pins the two courses idempotently and deactivates only session-free obsolete work", () => {
    expect(state).toContain("WHERE code IN ('USR07','CS111')");
    expect(state).toContain(
      "SELECT 1 FROM public.schedule_sessions ss WHERE ss.teaching_assignment_id = ta.id",
    );
    expect(state).toContain("SET is_active = false");
    expect(state).not.toContain("DELETE FROM public.teaching_assignments");
    expect(state).toContain("VERIFY_FAILED");
  });
});
