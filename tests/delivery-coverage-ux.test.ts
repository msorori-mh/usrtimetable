import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import {
  autoRunOutcomeMessage,
  coverageBlockers,
  isPartialRunOutcome,
  parseDeliveryCoverage,
  COVERAGE_GATED_STATUSES,
} from "../src/lib/schedule-versions/delivery-coverage";

const incompletePayload = {
  total_groups: 9,
  assigned_exactly_once: 9,
  unassigned_groups: 0,
  multi_assigned_groups: 0,
  groups_with_sessions: 3,
  groups_without_sessions: 6,
  exact_hours_groups: 3,
  short_hours_groups: 6,
  over_hours_groups: 0,
  required_hours: 20,
  scheduled_hours: 6,
  missing_hours: 14,
  extra_hours: 0,
  complete: false,
};

const completePayload = {
  ...incompletePayload,
  groups_with_sessions: 9,
  groups_without_sessions: 0,
  short_hours_groups: 0,
  exact_hours_groups: 9,
  scheduled_hours: 20,
  missing_hours: 0,
  complete: true,
};

describe("delivery coverage parsing", () => {
  it("normalizes the RPC payload", () => {
    const c = parseDeliveryCoverage(incompletePayload);
    expect(c.totalGroups).toBe(9);
    expect(c.groupsWithSessions).toBe(3);
    expect(c.groupsWithoutSessions).toBe(6);
    expect(c.requiredHours).toBe(20);
    expect(c.scheduledHours).toBe(6);
    expect(c.missingHours).toBe(14);
    expect(c.complete).toBe(false);
  });

  it("treats a missing payload as incomplete", () => {
    expect(parseDeliveryCoverage(null).complete).toBe(false);
    expect(parseDeliveryCoverage(null).totalGroups).toBe(0);
  });
});

describe("transition gating", () => {
  const incomplete = parseDeliveryCoverage(incompletePayload);
  const complete = parseDeliveryCoverage(completePayload);

  it("blocks review, approve and publish while coverage is incomplete", () => {
    for (const target of COVERAGE_GATED_STATUSES) {
      const blockers = coverageBlockers(target, incomplete);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain("غير مكتملة");
      expect(blockers[0]).toContain("6");
      expect(blockers[0]).toContain("14");
    }
  });

  it("allows the same transitions once coverage is complete", () => {
    for (const target of COVERAGE_GATED_STATUSES) {
      expect(coverageBlockers(target, complete)).toHaveLength(0);
    }
  });

  it("never blocks archive or rollback transitions", () => {
    expect(coverageBlockers("draft", incomplete)).toHaveLength(0);
    expect(coverageBlockers("archived", incomplete)).toHaveLength(0);
  });
});

describe("auto scheduler outcome", () => {
  it("reports a partial draft instead of success when groups remain", () => {
    const msg = autoRunOutcomeMessage({
      placed: 3,
      totalRequired: 9,
      unplaced: 6,
      coverage: parseDeliveryCoverage(incompletePayload),
    });
    expect(msg.partial).toBe(true);
    expect(msg.text).toContain("مسودة جزئية");
    expect(msg.text).toContain("3/9");
    expect(msg.text).toContain("6/20");
    expect(msg.text).toContain("عرض النواقص");
    expect(msg.text).not.toContain("تمت الجدولة بالكامل");
  });

  it("stays partial when nothing failed but coverage is still short", () => {
    expect(
      isPartialRunOutcome({ unplaced: 0, coverage: parseDeliveryCoverage(incompletePayload) }),
    ).toBe(true);
  });

  it("reports full completion only when coverage is complete", () => {
    const msg = autoRunOutcomeMessage({
      placed: 9,
      totalRequired: 9,
      unplaced: 0,
      coverage: parseDeliveryCoverage(completePayload),
    });
    expect(msg.partial).toBe(false);
    expect(msg.text).toContain("تمت الجدولة بالكامل");
  });
});

describe("UI wiring", () => {
  const card = fs.readFileSync(
    "src/components/schedule-versions/delivery-coverage-card.tsx",
    "utf8",
  );
  const versions = fs.readFileSync("src/routes/_authenticated/schedule-versions.tsx", "utf8");
  const auto = fs.readFileSync("src/routes/_authenticated/auto-schedule.tsx", "utf8");

  it("shows the completeness card with the required figures and a gaps view", () => {
    expect(card).toContain("اكتمال نسخة الجدول");
    expect(card).toContain("مكتمل 100%");
    expect(card).toContain("غير مكتمل");
    expect(card).toContain("المجموعات المسندة");
    expect(card).toContain("المجموعات المجدولة");
    expect(card).toContain("الساعات المجدولة");
    expect(card).toContain("الساعات الناقصة");
    expect(card).toContain("عرض النواقص");
  });

  it("gap details list program, component, group, students, instructor and hours", () => {
    for (const header of [
      "البرنامج",
      "النظام",
      "المستوى",
      "الدفعة",
      "المقرر",
      "المكوّن",
      "المجموعة",
      "الطلاب",
      "المدرس",
      "المطلوب",
      "المجدول",
      "الناقص",
      "الحالة",
    ]) {
      expect(card).toContain(header);
    }
  });

  it("the review/approve page merges coverage blockers into the action gates", () => {
    expect(versions).toContain("coverageBlockers(a.to, coverage.data)");
    expect(versions).toContain("<DeliveryCoverageCard");
  });

  it("the auto scheduler screen uses the partial-outcome message and coverage card", () => {
    expect(auto).toContain("autoRunOutcomeMessage");
    expect(auto).toContain("<DeliveryCoverageCard");
    expect(auto).toContain(
      'data-testid={outcome.partial ? "auto-run-partial" : "auto-run-complete"}',
    );
  });

  it("keeps management actions role-gated (read-only roles cannot act)", () => {
    expect(versions).toContain("disabled={!canManage || blocked || doTransition.isPending}");
    expect(auto).toContain("disabled={!canManage || runBlocked}");
    expect(auto).toContain("!versionId || run.isPending");
    expect(card).not.toContain(".insert(");
    expect(card).not.toContain(".update(");
  });
});
