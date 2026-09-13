/**
 * PUBLISHED-ONLY-REPORTS-01 — a `read_only`-ONLY viewer («مشاهد») reads timetable
 * data from PUBLISHED schedule versions only: no draft/review/approved version is
 * listed, selectable or used as a fallback. Admins and institutional viewers are
 * unaffected.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NO_PUBLISHED_VERSION_MESSAGE_AR,
  PUBLISHED_ONLY_STATUS_MODE,
  filterVisibleVersions,
  resolveReportStatusMode,
  sanitizeVersionSelection,
  visibleVersionStatuses,
} from "../src/lib/reports/published-only";
import { isReportsOnlyRole } from "../src/lib/viewer-roles";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const versions = [
  { id: "draft", status: "draft" },
  { id: "review", status: "review" },
  { id: "approved", status: "approved" },
  { id: "pub", status: "published" },
];

describe("published-only status mode", () => {
  it("pins a reports-only viewer to published_only whatever the page asks for", () => {
    for (const requested of ["working", "specific_version", "published_only"] as const) {
      assert.equal(resolveReportStatusMode(requested, true), PUBLISHED_ONLY_STATUS_MODE);
    }
  });

  it("leaves other accounts untouched", () => {
    assert.equal(resolveReportStatusMode("working", false), "working");
    assert.equal(resolveReportStatusMode("specific_version", false), "specific_version");
  });

  it("exposes published as the only visible status", () => {
    assert.deepEqual(visibleVersionStatuses(true), ["published"]);
    assert.ok(visibleVersionStatuses(false).length > 1);
  });
});

describe("version visibility and selection", () => {
  it("hides every non-published version from a reports-only viewer", () => {
    assert.deepEqual(
      filterVisibleVersions(versions, true).map((v) => v.id),
      ["pub"],
    );
    assert.equal(filterVisibleVersions(versions, false).length, 4);
  });

  it("rejects a stored/shared draft id and falls back to the published version", () => {
    assert.equal(sanitizeVersionSelection("draft", versions, true), "pub");
    assert.equal(sanitizeVersionSelection("review", versions, true), "pub");
    assert.equal(sanitizeVersionSelection("pub", versions, true), "pub");
  });

  it("never falls back to a draft when no published version exists", () => {
    const drafts = versions.filter((v) => v.status !== "published");
    assert.equal(sanitizeVersionSelection("draft", drafts, true), null);
    assert.equal(sanitizeVersionSelection(null, drafts, true), null);
    // A non-restricted account keeps its draft selection.
    assert.equal(sanitizeVersionSelection("draft", drafts, false), "draft");
  });
});

describe("role precedence", () => {
  const base = { isReadOnly: false, isSuperAdmin: false, isCollegeAdmin: false } as const;

  it("only a read_only-only account is restricted", () => {
    assert.equal(isReportsOnlyRole({ ...base, isReadOnly: true }), true);
    assert.equal(isReportsOnlyRole({ ...base, isReadOnly: true, isSuperAdmin: true }), false);
    assert.equal(isReportsOnlyRole({ ...base, isReadOnly: true, isCollegeAdmin: true }), false);
    assert.equal(
      isReportsOnlyRole({ ...base, isReadOnly: true, isInstitutionalViewer: true }),
      false,
    );
    assert.equal(isReportsOnlyRole(undefined), false);
  });
});

describe("wiring", () => {
  it("the report context resolves and exposes published-only", () => {
    const src = read("src/hooks/reports/useReportContext.ts");
    assert.match(src, /usePublishedOnlyReports\(\)/);
    assert.match(src, /resolveReportStatusMode\(/);
    assert.match(src, /filterVisibleVersions\(/);
    assert.match(src, /sanitizeVersionSelection\(/);
    assert.match(src, /statusMode: effectiveStatusMode/);
    assert.match(src, /publishedOnly,/);
  });

  it("the filter bar hides the version-scope selector for the restricted viewer", () => {
    const src = read("src/components/reports/report-filters.tsx");
    assert.match(src, /const showStatusMode = statusMode && !publishedOnly;/);
    assert.match(src, /\{showStatusMode && \(/);
    assert.ok(!/\{statusMode && \(/.test(src));
    assert.match(src, /PUBLISHED_ONLY_CONTEXT_LABEL_AR/);
  });

  it("the shell shows the no-published state instead of any fallback data", () => {
    const src = read("src/components/reports/report-shell.tsx");
    assert.match(src, /publishedOnly && !reportContext\.isLoading && !reportContext\.versionId/);
    assert.match(src, /NO_PUBLISHED_VERSION_MESSAGE_AR/);
    assert.equal(NO_PUBLISHED_VERSION_MESSAGE_AR.includes("منشورة"), true);
  });

  it("legacy report pages restrict their own version lists", () => {
    for (const route of [
      "reports.department-schedule",
      "reports.unscheduled",
      "reports.quality-summary",
      "reports.quality-analytics",
    ]) {
      const src = read(`src/routes/_authenticated/${route}.tsx`);
      assert.match(src, /usePublishedOnlyReports\(\)/, route);
      assert.match(src, /visibleVersionStatuses\(publishedOnly\)/, route);
    }
  });

  it("room utilisation counts published schedules only for the restricted viewer", () => {
    const src = read("src/routes/_authenticated/reports.room-utilization.tsx");
    assert.match(src, /publishedOnly\) q = q\.eq\("schedule_versions\.status", "published"\)/);
  });
});
