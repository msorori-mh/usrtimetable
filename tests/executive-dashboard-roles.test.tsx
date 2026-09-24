import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  canViewLeadership,
  executiveDashboardTitle,
  resolveViewerScopeRedirect,
  isViewerOnlyRole,
} from "../src/lib/viewer-roles";
import { CORE_PATH, canAccess, coreStepLabel } from "../src/lib/admin-nav";
import { LeadershipDecisionSummary } from "../src/components/reports/leadership-decision-summary";

test("president, dean and academic affairs use the executive entry with role-specific titles", () => {
  for (const [role, flags, title] of [
    ["university_leadership", { isUniversityLeadership: true }, "المؤشرات التنفيذية للجامعة"],
    ["college_dean", { isCollegeDean: true }, "المؤشرات التنفيذية للكلية"],
    [
      "institutional_viewer",
      { isInstitutionalViewer: true },
      "المؤشرات التنفيذية للشؤون الأكاديمية",
    ],
  ] as const) {
    assert.equal(canViewLeadership(flags), true);
    assert.equal(executiveDashboardTitle(flags), title);
    assert.equal(resolveViewerScopeRedirect(flags, "/dashboard"), "/reports/leadership");
    const steps = CORE_PATH.filter((step) => canAccess(step, [role]));
    assert.ok(steps.some((step) => step.to === "/reports/leadership"));
    assert.ok(!steps.some((step) => step.to === "/schedule-builder"));
    if (role !== "university_leadership") {
      assert.equal(coreStepLabel(steps[0], [role]).label, title);
    }
    assert.equal(
      steps.some((step) => step.to === "/instructors"),
      role === "institutional_viewer",
    );
  }
});

test("generic viewers and college administrators gain no executive access", () => {
  for (const flags of [null, {}, { isReadOnly: true }, { isCollegeAdmin: true }]) {
    assert.equal(canViewLeadership(flags), false);
  }
  assert.equal(resolveViewerScopeRedirect({ isReadOnly: true }, "/dashboard"), "/reports");
  assert.equal(resolveViewerScopeRedirect({ isInstitutionalViewer: true }, "/instructors"), null);
  assert.equal(
    resolveViewerScopeRedirect({ isSuperAdmin: true, isInstitutionalViewer: true }, "/users"),
    null,
  );
  assert.equal(isViewerOnlyRole({ isInstitutionalViewer: true }), true);
});

test("dean and university summaries share all four card colors, RTL layout and detail actions", () => {
  for (const scope of ["university", "college"] as const) {
    const html = renderToStaticMarkup(
      <LeadershipDecisionSummary
        scope={scope}
        colleges={[]}
        uniqueFaculty={null}
        capacity={[]}
        capacityState="restricted"
        onOpen={() => {}}
      />,
    );
    for (const tone of ["schedules", "teaching", "faculty", "rooms"]) {
      assert.ok(html.includes(`leadership-card--${tone}`));
    }
    assert.match(html, /dir="rtl"/);
    assert.match(html, /عرض المحاضرين والأنصبة/);
    assert.ok(html.includes(scope === "college" ? "نظرة الكلية السريعة" : "نظرة الجامعة السريعة"));
    if (scope === "college")
      assert.doesNotMatch(html, /نظرة الجامعة السريعة|الكليات في نظرة واحدة/);
  }
  const page = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
  assert.match(page, /leadership-dashboard\.css/);
  assert.match(page, /<LeadershipDecisionSummary/);
  assert.match(page, /title=\{executiveDashboardTitle\(me\)\}/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});
