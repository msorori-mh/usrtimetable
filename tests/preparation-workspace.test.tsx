import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { PreparationWorkspace } from "../src/components/data-onboarding/preparation-workspace";
import { PREPARATION_STEPS } from "../src/lib/data-onboarding/preparation";
import type { OnboardingReadinessSnapshot } from "../src/lib/data-onboarding/snapshot";
import { classifyNewFlowReadinessIssues } from "../src/lib/data-onboarding/classify";

const snapshot = {
  steps: PREPARATION_STEPS.map((s) => ({
    id: s.id,
    titleAr: s.title,
    helpEli5Ar: s.description,
    fixHref: s.manualLinks[0]?.href ?? "/data-onboarding",
    status: "complete",
    detailAr: "تم تجهيز البيانات",
  })),
  hasElectives: false,
  newFlowIssues: [],
} as unknown as OnboardingReadinessSnapshot;
async function render(canManage: boolean, overrides = {}) {
  const route = createRootRoute({
    component: () => (
      <PreparationWorkspace
        snapshot={snapshot}
        selectedStep="instructors"
        selectedEntity="instructors"
        showHelp
        canManage={canManage}
        refreshing={false}
        onSelect={() => {}}
        importer={<div>UPLOAD_FORM_SENTINEL</div>}
        {...overrides}
      />
    ),
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}
test("read-only users see progress and guide but cannot reach embedded import actions", async () => {
  const html = await render(false);
  assert.ok(html.includes("onboarding-readonly-note"));
  assert.ok(html.includes("ساعات_إعفاء_إداري"));
  assert.ok(!html.includes("UPLOAD_FORM_SENTINEL"));
  assert.ok(!html.includes("تجهيز ورفع ملف Excel"));
});
test("managers see the scoped importer, current step and complete canonical field guide", async () => {
  const html = await render(true);
  assert.ok(html.includes("UPLOAD_FORM_SENTINEL"));
  assert.ok(html.includes('aria-current="step"'));
  assert.ok(html.includes("الجهة_الخارجية"));
  assert.ok(!html.includes("canonical"));
});
test("readiness failure blocks the schedule CTA, and the first schedule is allowed after preparation", async () => {
  const ready = await render(true, { selectedStep: "readiness_check", selectedEntity: undefined });
  assert.ok(ready.includes("الانتقال إلى إنشاء الجدول"));
  const blocked = await render(true, {
    selectedStep: "readiness_check",
    selectedEntity: undefined,
    snapshot: {
      ...snapshot,
      steps: snapshot.steps.map((s) => (s.id === "cohorts" ? { ...s, status: "blocker" } : s)),
    },
  });
  assert.ok(blocked.includes("استكمل النواقص قبل إنشاء الجدول"));
  assert.ok(!blocked.includes("الانتقال إلى إنشاء الجدول"));
});

test("final review links managers and read-only viewers to the exact missing instructor field", async () => {
  const newFlowIssues = classifyNewFlowReadinessIssues([
    { label: "محاضرون بدون تخصص", missing: 32, total: 32, category: "resources" },
    { label: "محاضرون بدون قسم", missing: 2, total: 32, category: "resources" },
  ]);
  for (const canManage of [true, false]) {
    const html = await render(canManage, {
      selectedStep: "readiness_check",
      selectedEntity: undefined,
      snapshot: { ...snapshot, newFlowIssues },
    });
    assert.ok(html.includes("/instructors?review=missing_specialization"));
    assert.ok(html.includes("/instructors?review=missing_department"));
    assert.ok(html.includes(canManage ? "أصلح الآن" : "عرض البيانات"));
    if (!canManage) assert.ok(!html.includes("أصلح الآن"));
  }
});
