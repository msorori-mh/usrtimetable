import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const page = read("src/routes/_authenticated/system-health.tsx");
assert(page.includes("system-health"), "route");
assert(!/service_role|DATABASE_URL|apikey|secret/i.test(page), "no secrets in UI source");
assert(page.includes("BACKUP-RESTORE-READINESS-RUNBOOK"), "links runbook");
assert(
  read("docs/PLATFORM-LAUNCH/BACKUP-RESTORE-READINESS-RUNBOOK.md").includes("do **not** execute"),
);
console.log("system-health-backup.harness.ts: PASS");
