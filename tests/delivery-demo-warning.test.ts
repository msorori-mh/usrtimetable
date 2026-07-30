import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DELIVERY_DEMO_MARKER,
  DELIVERY_DEMO_WARNING_AR,
  isDeliveryDemoVersion,
} from "../src/lib/schedule-versions/delivery-demo.ts";
import { selectContainsNestedCoursesEmbed } from "../src/lib/reports/queries/session-queries.ts";

describe("delivery demo warning markers", () => {
  it("detects delivery demo name/notes and exposes Arabic warning text", () => {
    assert.equal(
      isDeliveryDemoVersion({
        name: "نسخة التسليم التجريبية النهائية — بيانات افتراضية — 2026-T1",
        notes: `${DELIVERY_DEMO_MARKER}: for handoff only`,
      }),
      true,
    );
    assert.equal(
      isDeliveryDemoVersion({
        name: "E2E-ITCS-2026-T1-20260729-01",
        notes: "regular experimental",
      }),
      false,
    );
    assert.match(DELIVERY_DEMO_WARNING_AR, /بيانات افتراضية/);
    assert.match(DELIVERY_DEMO_WARNING_AR, /التسليم/);
  });

  it("keeps published timetable report free of nested courses embed and shows banner via leading", () => {
    const reportSrc = readFileSync(
      new URL("../src/routes/_authenticated/reports.published-timetable.tsx", import.meta.url),
      "utf8",
    );
    const shellSrc = readFileSync(
      new URL("../src/components/reports/report-shell.tsx", import.meta.url),
      "utf8",
    );
    assert.equal(selectContainsNestedCoursesEmbed(reportSrc), false);
    assert.match(reportSrc, /fetchHydratedVersionSessions/);
    assert.match(reportSrc, /leading=\{/);
    assert.match(reportSrc, /DeliveryDemoWarningBanner/);
    assert.match(shellSrc, /leading\?: ReactNode/);
    assert.match(shellSrc, /\{leading\}/);
  });
});
