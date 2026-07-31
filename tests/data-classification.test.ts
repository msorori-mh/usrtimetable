import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  canConvertToOperationalViaOfficialPath,
  filterVersionsByClassification,
  isDemoOrTestClassification,
  isOperationalOfficialReportEligible,
  isProtectedAcceptedScheduleVersion,
  PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
  resolveDataClassification,
  shouldBlockOperationalApprovalMessaging,
} from "../src/lib/schedule-versions/data-classification";
import { DELIVERY_DEMO_MARKER } from "../src/lib/schedule-versions/delivery-demo";

const MIGRATION_REL =
  "supabase/migrations/20260731120000_source_only_data_classification.sql";
const APPLY_PKG_REL =
  "docs/PLATFORM-LAUNCH/apply-packages/DATA-CLASSIFICATION-APPLY.md";
const EXPECTED_SHA256 =
  "30C29D423DE6995543415492BE13C3FC26F045704333817E99BCA85087B9ED87";

const root = join(import.meta.dir, "..");
const migrationPath = join(root, MIGRATION_REL);
const migration = readFileSync(migrationPath, "utf8");
const applyPkg = readFileSync(join(root, APPLY_PKG_REL), "utf8");

const demoVersion = {
  id: "demo-1",
  name: "نسخة التسليم التجريبية النهائية — بيانات افتراضية — 2026-T1",
  notes: `${DELIVERY_DEMO_MARKER}: for handoff only`,
};
const operationalVersion = {
  id: "op-1",
  name: "جدول تشغيلي 2026-T1",
  notes: "official college timetable",
  data_classification: "operational" as const,
};
const testColumnVersion = {
  id: "test-1",
  name: "RBAC clone",
  notes: null,
  data_classification: "test" as const,
};
const unclassified = {
  id: "u-1",
  name: "E2E-ITCS-2026-T1-20260729-01",
  notes: "regular experimental",
};

describe("data classification helpers", () => {
  test("resolves column values and marker fallback to demo", () => {
    expect(resolveDataClassification(demoVersion)).toBe("demo");
    expect(resolveDataClassification(operationalVersion)).toBe("operational");
    expect(resolveDataClassification(testColumnVersion)).toBe("test");
    expect(resolveDataClassification(unclassified)).toBe(null);
    expect(
      resolveDataClassification({
        name: "x",
        notes: null,
        data_classification: "archived",
      }),
    ).toBe("archived");
  });

  test("demo is not official by default; visible with explicit filter", () => {
    expect(isOperationalOfficialReportEligible(demoVersion)).toBe(false);
    expect(isDemoOrTestClassification(demoVersion)).toBe(true);

    const list = [demoVersion, operationalVersion, unclassified];
    expect(filterVersionsByClassification(list, "official").map((v) => v.id)).toEqual([
      "op-1",
      "u-1",
    ]);
    expect(filterVersionsByClassification(list, "demo").map((v) => v.id)).toEqual(["demo-1"]);
    expect(filterVersionsByClassification(list, "all").map((v) => v.id)).toEqual([
      "demo-1",
      "op-1",
      "u-1",
    ]);
    expect(filterVersionsByClassification(list, "demo_and_test").map((v) => v.id)).toEqual([
      "demo-1",
    ]);
  });

  test("operational does not show demo warning / approval block", () => {
    expect(isDemoOrTestClassification(operationalVersion)).toBe(false);
    expect(shouldBlockOperationalApprovalMessaging(operationalVersion)).toBe(false);
    expect(isOperationalOfficialReportEligible(operationalVersion)).toBe(true);
  });

  test("test classification is not official; archived is not official", () => {
    expect(isOperationalOfficialReportEligible(testColumnVersion)).toBe(false);
    expect(
      isOperationalOfficialReportEligible({
        name: "old",
        data_classification: "archived",
      }),
    ).toBe(false);
  });

  test("official convert path stub is disabled", () => {
    expect(
      canConvertToOperationalViaOfficialPath({
        isSuperAdmin: true,
        hasOfficialApprovalToken: true,
      }),
    ).toBe(false);
  });

  test("protects accepted schedule version id constant", () => {
    expect(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID).toBe(
      "835e50fe-3ad2-4232-8c15-0f403c668a7f",
    );
    expect(isProtectedAcceptedScheduleVersion(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID)).toBe(
      true,
    );
    expect(isProtectedAcceptedScheduleVersion("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      false,
    );
    expect(migration).toContain(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID);
    expect(applyPkg).toContain(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID);
  });
});

describe("data classification migration source-only contract", () => {
  test("migration file exists with documented SHA256 and is not applied", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sha = createHash("sha256").update(readFileSync(migrationPath)).digest("hex").toUpperCase();
    expect(sha).toBe(EXPECTED_SHA256);
    expect(applyPkg).toContain(EXPECTED_SHA256);
    expect(migration.startsWith("-- SOURCE-ONLY / NOT APPLIED")).toBe(true);
    expect(migration).toContain("DEFAULT NULL");
    expect(migration).toContain("data_classification");
    expect(migration).toMatch(/CHECK[\s\S]*data_classification IS NULL/);
    expect(migration).toContain("'test'");
    expect(migration).toContain("'demo'");
    expect(migration).toContain("'operational'");
    expect(migration).toContain("'archived'");
    expect(migration).toContain("SET search_path = public, pg_temp");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.enforce_data_classification_super_admin_only()");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("DATA_CLASSIFICATION_SUPER_ADMIN_REQUIRED");
    expect(migration).toContain("import_runs");
    expect(migration).toMatch(/SKIPPED|does not exist/i);
    // No Legacy mass reclassify / no Operational backfill
    expect(migration).not.toMatch(/UPDATE\s+public\.schedule_versions/i);
    expect(migration).not.toMatch(/SET\s+data_classification\s*=\s*'operational'/i);
  });

  test("apply package documents do-not-apply and not-in-applied-list", () => {
    expect(applyPkg).toContain("DO NOT APPLY");
    expect(applyPkg).toContain("Not in applied list");
    expect(applyPkg).toContain("PHASE_3_SOURCE_READY_WAITING_FOR_EXPLICIT_MIGRATION_APPROVAL");
    expect(applyPkg).toContain(MIGRATION_REL.replace(/\\/g, "/"));
  });
});
