import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/deploy-staging.yml", import.meta.url),
  "utf8",
);

test("staging workflow is manual/label-gated, isolated, and environment-protected", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.label\.name == 'deploy-staging'/);
  assert.match(workflow, /head\.ref == 'codex\/staging-instructor-builder-20260928'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /STAGING_DEPLOY_CONFIRM: DEPLOY_STAGING_ONLY/);
  assert.match(workflow, /test "\$REMOTE_SHA" = "\$DEPLOY_SHA"/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /\bon:\s*push\b/);
});

test("deployment stays behind preflight, uses pinned actions, and never applies migrations", () => {
  const preflight = workflow.indexOf("Fail-closed target preflight");
  const deploy = workflow.indexOf("Deploy the isolated staging Worker");
  assert.ok(preflight >= 0 && deploy > preflight);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /oven-sh\/setup-bun@[0-9a-f]{40}/);
  assert.match(workflow, /cloudflare\/wrangler-action@[0-9a-f]{40}/);
  assert.match(workflow, /wranglerVersion: "4\.136\.3"/);
  assert.match(workflow, /command: deploy --config \.output\/server\/wrangler\.json/);
  assert.doesNotMatch(workflow, /supabase\s+(?:db\s+)?(?:push|reset|migration|link)/i);
  assert.doesNotMatch(workflow, /psql\s+.*STAGING/i);
});

test("runtime values come only from the staging environment and browser proof is read-only", () => {
  for (const name of [
    "STAGING_SUPABASE_URL",
    "STAGING_SUPABASE_PROJECT_ID",
    "STAGING_SUPABASE_PUBLISHABLE_KEY",
    "STAGING_SUPABASE_SERVICE_ROLE_KEY",
    "STAGING_ADMIN_EMAIL",
    "STAGING_ADMIN_PASSWORD",
  ])
    assert.match(workflow, new RegExp(`secrets\\.${name}`));
  assert.match(workflow, /Authenticated read-only staging smoke test/);
  assert.match(workflow, /tests\/cohort-component-single-instructor-db\.test\.mjs/);
});
