import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canConvertToOperationalViaOfficialPath,
  filterVersionsByClassification,
  isDemoOrTestClassification,
  isOperationalOfficialReportEligible,
  isProtectedAcceptedScheduleVersion,
  PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
  resolveDataClassification,
  shouldBlockOperationalApprovalMessaging,
} from "../../src/lib/schedule-versions/data-classification.ts";
import { DELIVERY_DEMO_MARKER } from "../../src/lib/schedule-versions/delivery-demo.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationRel = "supabase/migrations/20260731120000_source_only_data_classification.sql";
const applyRel = "docs/PLATFORM-LAUNCH/apply-packages/DATA-CLASSIFICATION-APPLY.md";
const expectedSha =
  "30C29D423DE6995543415492BE13C3FC26F045704333817E99BCA85087B9ED87";

const migrationPath = join(root, migrationRel);
assert(existsSync(migrationPath), "migration file must exist");
const migration = readFileSync(migrationPath, "utf8");
const applyPkg = readFileSync(join(root, applyRel), "utf8");
const publishedUi = readFileSync(
  join(root, "src/routes/_authenticated/published-schedules.tsx"),
  "utf8",
);
const reportUi = readFileSync(
  join(root, "src/routes/_authenticated/reports.published-timetable.tsx"),
  "utf8",
);
const versionsUi = readFileSync(
  join(root, "src/routes/_authenticated/schedule-versions.tsx"),
  "utf8",
);
const bannerUi = readFileSync(
  join(root, "src/components/schedule/delivery-demo-warning-banner.tsx"),
  "utf8",
);
const badgeUi = readFileSync(
  join(root, "src/components/schedule/data-classification-badge.tsx"),
  "utf8",
);

assert(migration.startsWith("-- SOURCE-ONLY / NOT APPLIED"), "migration is explicitly not applied");
const sha = createHash("sha256").update(readFileSync(migrationPath)).digest("hex").toUpperCase();
assert(sha === expectedSha, `migration SHA256 mismatch: ${sha}`);
assert(applyPkg.includes(expectedSha), "apply package must document SHA256");
assert(applyPkg.includes("Not in applied list"), "apply package must say not in applied list");
assert(
  applyPkg.includes("PHASE_3_SOURCE_READY_WAITING_FOR_EXPLICIT_MIGRATION_APPROVAL"),
  "decision gate documented",
);
assert(migration.includes("DEFAULT NULL"), "column default must be NULL (no Operational auto)");
assert(!/UPDATE\s+public\.schedule_versions/i.test(migration), "no schedule_versions UPDATE backfill");
assert(
  migration.includes("REVOKE ALL ON FUNCTION public.enforce_data_classification_super_admin_only()"),
  "revoke trigger fn from PUBLIC/anon/authenticated",
);
assert(migration.includes(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID), "protect version id in migration comments");
assert(
  isProtectedAcceptedScheduleVersion(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID),
  "helper protects accepted version",
);

const demo = {
  name: "نسخة التسليم التجريبية",
  notes: `${DELIVERY_DEMO_MARKER}: handoff`,
};
const operational = {
  name: "جدول تشغيلي",
  notes: "ok",
  data_classification: "operational",
};
const unclassified = { name: "E2E-ITCS-2026-T1", notes: "experimental" };

assert(resolveDataClassification(demo) === "demo", "marker → demo");
assert(isOperationalOfficialReportEligible(demo) === false, "demo not official by default");
assert(isDemoOrTestClassification(demo) === true, "demo is demo/test");
assert(
  filterVersionsByClassification([demo, operational, unclassified], "official").length === 2,
  "official filter hides demo",
);
assert(
  filterVersionsByClassification([demo, operational], "demo").length === 1,
  "explicit demo filter keeps demo visible",
);
assert(isDemoOrTestClassification(operational) === false, "operational has no demo warning");
assert(
  shouldBlockOperationalApprovalMessaging(operational) === false,
  "operational does not block approval messaging",
);
assert(
  shouldBlockOperationalApprovalMessaging(demo) === true,
  "demo blocks operational approval messaging",
);
assert(
  canConvertToOperationalViaOfficialPath({
    isSuperAdmin: true,
    hasOfficialApprovalToken: true,
  }) === false,
  "convert stub must remain disabled",
);

assert(publishedUi.includes('useState<ClassificationListFilter>("official")'), "published default official");
assert(publishedUi.includes("classification-filter"), "published has classification filter");
assert(publishedUi.includes("DataClassificationBadge"), "published shows badge");
assert(reportUi.includes('useState<ClassificationListFilter>("official")'), "report default official");
assert(reportUi.includes("filterVersionsByClassification"), "report filters by classification");
assert(versionsUi.includes("NonOperationalApprovalBanner"), "versions show non-operational banner");
assert(versionsUi.includes("blockOperationalMessaging"), "versions disable demo approve/publish");
assert(bannerUi.includes("non-operational-approval-banner"), "banner test id present");
assert(badgeUi.includes("DATA") || badgeUi.includes("data-classification-badge"), "badge component present");
assert(badgeUi.includes("TEST") || badgeUi.includes("CLASSIFICATION_LABEL_EN"), "badge labels TEST/DEMO/OPERATIONAL");

// Confirm migration is source-only artifact (not claimed applied in apply package).
assert(applyPkg.includes("DO NOT APPLY"), "apply package forbids apply without approval");
assert(!applyPkg.match(/Status:\s*APPLIED/i), "must not claim APPLIED");

console.log("data-classification.harness.ts: PASS");
