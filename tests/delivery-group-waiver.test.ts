import { describe, expect, it } from "vitest";
import {
  applyDeliveryGroupWaiver,
  DELIVERY_GROUP_WAIVER_COLLEGE_ID,
  DELIVERY_GROUP_WAIVER_TERM_ID,
  DELIVERY_GROUP_WAIVER_TERM_NAME,
  DELIVERY_GROUP_WAIVER_VERSION_ID,
  isDeliveryGroupWaiverScope,
  summarizeDeliveryGroupWaiverForQuality,
} from "@/lib/schedule-versions/delivery-group-waiver";

const scope = {
  collegeId: DELIVERY_GROUP_WAIVER_COLLEGE_ID,
  termId: DELIVERY_GROUP_WAIVER_TERM_ID,
  termName: DELIVERY_GROUP_WAIVER_TERM_NAME,
  scheduleVersionId: DELIVERY_GROUP_WAIVER_VERSION_ID,
};

const conflicts = () => [
  { code: "delivery_group_conflict", severity: "hard" as const },
  { code: "instructor_conflict", severity: "hard" as const },
  { code: "room_conflict", severity: "hard" as const },
];

describe("delivery group publish waiver scope", () => {
  it("matches only the authorized college + term + version", () => {
    expect(isDeliveryGroupWaiverScope(scope)).toBe(true);
  });

  it("rejects another schedule version", () => {
    expect(
      isDeliveryGroupWaiverScope({
        ...scope,
        scheduleVersionId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe(false);
  });

  it("rejects another college", () => {
    expect(
      isDeliveryGroupWaiverScope({
        ...scope,
        collegeId: "7168345f-cf9d-4789-b2ad-547abb687dc8",
      }),
    ).toBe(false);
  });

  it("rejects another term", () => {
    expect(
      isDeliveryGroupWaiverScope({
        ...scope,
        termId: "d01e8563-dfed-4189-a469-82320370f3e3",
        termName: "الفصل الثاني 2026-2027",
      }),
    ).toBe(false);
  });

  it("fails closed on missing scope data", () => {
    expect(isDeliveryGroupWaiverScope({})).toBe(false);
    expect(isDeliveryGroupWaiverScope({ ...scope, termName: null })).toBe(false);
  });
});

describe("delivery group waiver application", () => {
  it("waives only delivery group results inside scope", () => {
    const out = applyDeliveryGroupWaiver(conflicts(), scope);
    expect(out.active).toBe(true);
    expect(out.waivedCount).toBe(1);
    expect(out.conflicts.find((c) => c.code === "delivery_group_conflict")?.severity).toBe("soft");
    expect(out.conflicts.find((c) => c.code === "instructor_conflict")?.severity).toBe("hard");
    expect(out.conflicts.find((c) => c.code === "room_conflict")?.severity).toBe("hard");
  });

  it("keeps everything hard outside scope", () => {
    const out = applyDeliveryGroupWaiver(conflicts(), {
      ...scope,
      collegeId: "d78cf264-3a76-43a1-8601-4d6def12b400",
    });
    expect(out.active).toBe(false);
    expect(out.waivedCount).toBe(0);
    expect(out.conflicts.every((c) => c.severity === "hard")).toBe(true);
  });
});


describe("delivery group waiver quality summary", () => {
  it("removes only waived delivery-group blockers from persisted counts", () => {
    const out = summarizeDeliveryGroupWaiverForQuality(
      [
        {
          code: "delivery_group_conflict",
          severity: "hard" as const,
          approved_exception: false,
        },
        {
          code: "instructor_conflict",
          severity: "hard" as const,
          approved_exception: false,
        },
        {
          code: "room_conflict",
          severity: "hard" as const,
          approved_exception: true,
        },
      ],
      scope,
    );

    expect(out.active).toBe(true);
    expect(out.waivedCount).toBe(1);
    expect(out.totalHardConflicts).toBe(2);
    expect(out.approvedHardConflicts).toBe(1);
    expect(out.unapprovedHardConflicts).toBe(1);
  });

  it("persists zero hard blockers when all current-scope conflicts are waivable", () => {
    const out = summarizeDeliveryGroupWaiverForQuality(
      Array.from({ length: 38 }, () => ({
        code: "delivery_group_conflict",
        severity: "hard" as const,
        approved_exception: false,
      })),
      scope,
    );

    expect(out.waivedCount).toBe(38);
    expect(out.totalHardConflicts).toBe(0);
    expect(out.unapprovedHardConflicts).toBe(0);
  });

  it("fails closed outside the authorized scope", () => {
    const out = summarizeDeliveryGroupWaiverForQuality(conflicts(), {
      ...scope,
      termName: "الفصل الثاني 2026-2027",
    });

    expect(out.active).toBe(false);
    expect(out.waivedCount).toBe(0);
    expect(out.totalHardConflicts).toBe(3);
    expect(out.unapprovedHardConflicts).toBe(3);
  });
});
