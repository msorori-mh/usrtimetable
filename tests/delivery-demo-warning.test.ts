import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DELIVERY_DEMO_MARKER,
  DELIVERY_DEMO_WARNING_AR,
  isDeliveryDemoVersion,
} from "../src/lib/schedule-versions/delivery-demo.ts";

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
});
