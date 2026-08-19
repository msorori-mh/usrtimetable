import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const builder = read("src/routes/_authenticated/schedule-builder.tsx");
const workItems = read("src/components/schedule-builder/v2-work-items-panel.tsx");
const editSheet = read("src/components/schedule-builder/session-edit-sheet.tsx");

// The schedule canvas remains the primary surface; secondary detail follows it.
assert.ok(builder.includes('data-testid="builder-advanced-view-options"'));
assert.ok(builder.includes("خيارات العرض والتفاصيل"));
assert.ok(
  builder.indexOf("{/* Grid / states */}") <
    builder.indexOf('data-testid="builder-advanced-view-options"'),
  "weekly grid is rendered before advanced view details",
);
assert.ok(
  builder.indexOf("<V2WorkItemsPanel") <
    builder.indexOf('data-testid="builder-advanced-view-options"'),
  "unscheduled work stays discoverable before advanced details",
);

// No capability was removed: version shortcuts, statistics, and all six filters remain.
assert.ok(builder.includes("اختصارات نسخ الجدول"));
assert.ok(builder.includes("ملخص النسخة الحالية"));
for (const label of [
  "المدرس",
  "مجموعة المحاضرة أو المعمل",
  "القاعة",
  "البرنامج",
  "المستوى",
  "نوع الجلسة",
]) {
  assert.ok(builder.includes(`label="${label}"`), `filter remains: ${label}`);
}

// Unscheduled work is summarized, expandable, and still gated by the server payload + role.
assert.ok(workItems.includes('data-testid="builder-unscheduled-work-toggle"'));
assert.ok(workItems.includes("aria-expanded={expanded}"));
assert.ok(workItems.includes("const mayCreate = canManage && !!payload?.can_manage"));
assert.ok(workItems.includes("const mayShowCreateAction = canManage && !!payload?.can_manage"));
assert.ok(workItems.includes('payload.version_status === "draft"'));
assert.ok(workItems.includes("disabled={!mayCreate || !item.can_create_session}"));
assert.ok(
  workItems.includes("{mayShowCreateAction ? (") &&
    workItems.indexOf("{mayShowCreateAction ? (") < workItems.indexOf("إضافة إلى الجدول"),
  "read-only users never receive the create action in the rendered tree",
);

// Editing is presented as a three-step safe flow without weakening the save gate.
assert.ok(editSheet.includes('data-testid="session-edit-safe-steps"'));
assert.ok(editSheet.includes('data-testid="session-static-details"'));
assert.ok(editSheet.includes("1. تطبيق محليًا"));
assert.ok(editSheet.includes("2. فحص التعارضات"));
assert.ok(editSheet.includes("3. حفظ التغيير بأمان"));
assert.ok(editSheet.includes("canSaveAfterValidation(validation)"));
assert.ok(editSheet.includes("disabled={!saveEnabled}"));

// Security invariant: the builder still uses RPC helpers and no direct session mutations.
assert.ok(builder.includes("validateScheduleSessionMove(pending)"));
assert.ok(builder.includes("moveOrRescheduleScheduleSession"));
assert.doesNotMatch(builder, /\.from\(["']schedule_sessions["']\)\s*\.update\s*\(/);
assert.doesNotMatch(builder, /\.from\(["']schedule_sessions["']\)\s*\.delete\s*\(/);

console.log("builder-progressive-disclosure.harness.ts: PASS");
