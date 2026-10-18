import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LEGACY_LOVABLE_PROJECT_REF,
  prepareProductionWranglerConfig,
  validateProductionEnvironment,
  validateStagingEnvironment,
} from "../scripts/staging/deploy-preflight.mjs";
import { checkSmokeResponse } from "../scripts/production/smoke.mjs";

const workflow = await readFile(
  new URL("../.github/workflows/deploy-production.yml", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------- workflow contract
test("production workflow is manual-only, typed-confirmation gated and environment-protected", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /\n      sha:\n[\s\S]*?required: true/);
  assert.match(workflow, /inputs\.confirmation == 'deploy-production'/);
  assert.match(workflow, /environment:\n\s+name: production/);
  assert.match(workflow, /Required reviewers/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /group: usrtimetable-production/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("the SHA must be on main and have passed every pr-gate job before anything is built", () => {
  const order = [
    "Checkout the exact candidate SHA",
    "Prove the candidate is on main",
    "Require a green pr-gate on this exact SHA",
    "Fail-closed production target preflight",
    "TypeScript",
    "Unit tests",
    "Build the Cloudflare Worker",
    "Validate and bind the generated config",
    "Deploy the production Worker",
    "Post-deploy smoke check",
  ].map((name) => workflow.indexOf(name));
  for (const [i, pos] of order.entries()) assert.ok(pos >= 0, `step ${i} missing`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "steps out of order");
  assert.match(workflow, /git merge-base --is-ancestor "\$DEPLOY_SHA" origin\/main/);
  for (const job of [
    "typecheck, lint, repository rules",
    "unit tests (bun, vitest, node, scripts)",
    "PGlite database tests",
    "SQL tests on the replayed schema",
  ])
    assert.ok(workflow.includes(`"${job}"`), `pr-gate job not required: ${job}`);
  // The pr-gate job names must match the jobs that pr-gate.yml really defines.
  const prGate = readFileSync(".github/workflows/pr-gate.yml", "utf8");
  for (const name of [...prGate.matchAll(/^    name: (.+)$/gm)].map((m) => m[1].trim()))
    assert.ok(workflow.includes(`"${name}"`), `pr-gate job "${name}" not checked by production`);
});

test("deploy uses the pinned actions/wrangler of staging and never touches the database", () => {
  const staging = readFileSync(".github/workflows/deploy-staging.yml", "utf8");
  const wranglerPin = staging.match(/cloudflare\/wrangler-action@([0-9a-f]{40})/)[1];
  assert.ok(workflow.includes(`cloudflare/wrangler-action@${wranglerPin}`));
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /oven-sh\/setup-bun@[0-9a-f]{40}/);
  assert.match(workflow, /wranglerVersion: "4\.136\.3"/);
  assert.match(workflow, /command: deploy --config \.output\/server\/wrangler\.json/);
  assert.match(workflow, /deploy-preflight\.mjs --production --prepare-build-config/);
  assert.doesNotMatch(workflow, /supabase\s+(?:db\s+)?(?:push|reset|migration|link)/i);
  assert.doesNotMatch(workflow, /\bpsql\b|pg_restore|schema_migrations/i);
});

test("build uses production public vars; the Worker gets exactly the four runtime secrets", () => {
  assert.match(workflow, /VITE_SUPABASE_URL: \$\{\{ secrets\.PROD_SUPABASE_URL \}\}/);
  assert.match(
    workflow,
    /VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.PROD_SUPABASE_PUBLISHABLE_KEY \}\}/,
  );
  const secretsBlock = workflow.match(/secrets: \|\n((?:\s{12}\S+\n)+)/)[1].trim().split(/\s+/);
  assert.deepEqual(secretsBlock, [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SITE_URL",
  ]);
  assert.doesNotMatch(workflow, /STAGING_/);
  assert.doesNotMatch(workflow, /VITE_[A-Z_]*SERVICE_ROLE/);
  assert.doesNotMatch(workflow, /\\\$\{\{/);
});

// ---------------------------------------------------------------- preflight (production mode)
const jwt = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature-for-contract-test`;
};
const PROD_REF = "universityprodref01";
const safe = (overrides = {}) => ({
  PRODUCTION_DEPLOY_CONFIRM: "deploy-production",
  DEPLOY_SHA: "a".repeat(40),
  PROD_WORKER_NAME: "usrtimetable",
  PROD_ROUTE: "timetable.usr.example.edu",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "cloudflare-test-token-long-enough",
  PROD_SUPABASE_PROJECT_ID: PROD_REF,
  PROD_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  PROD_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
  PROD_SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  PROD_SITE_URL: "https://timetable.usr.example.edu",
  ...overrides,
});
const opts = (extra = {}) => ({ productionRef: PROD_REF, currentSha: "a".repeat(40), ...extra });

test("accepts a confirmed production target bound to supabase/config.toml", () => {
  const result = validateProductionEnvironment(safe(), opts());
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.mode, "production");
  assert.equal(result.summary.route, "timetable.usr.example.edu");
});

test("rejects the legacy Lovable project, a ref drifting from config.toml and staging names", () => {
  const legacy = validateProductionEnvironment(
    safe({
      PROD_SUPABASE_PROJECT_ID: LEGACY_LOVABLE_PROJECT_REF,
      PROD_SUPABASE_URL: `https://${LEGACY_LOVABLE_PROJECT_REF}.supabase.co`,
    }),
    opts({ productionRef: LEGACY_LOVABLE_PROJECT_REF }),
  );
  assert.equal(legacy.ok, false);
  assert.match(legacy.errors.join("\n"), /legacy Lovable Cloud project/);
  assert.match(legacy.errors.join("\n"), /config\.toml project_id still names/);

  const drift = validateProductionEnvironment(
    safe({ PROD_WORKER_NAME: "usrtimetable-staging", STAGING_SUPABASE_PROJECT_ID: PROD_REF }),
    opts({ productionRef: "someotherref" }),
  );
  assert.equal(drift.ok, false);
  assert.match(drift.errors.join("\n"), /must equal project_id in supabase\/config\.toml/);
  assert.match(drift.errors.join("\n"), /without 'staging'/);
  assert.match(drift.errors.join("\n"), /Staging and production Supabase project ids must differ/);
});

test("rejects missing confirmation, SHA drift, swapped keys, platform routes and SITE_URL mismatch", () => {
  const result = validateProductionEnvironment(
    safe({
      PRODUCTION_DEPLOY_CONFIRM: "DEPLOY_STAGING_ONLY",
      DEPLOY_SHA: "c".repeat(40),
      PROD_SUPABASE_PUBLISHABLE_KEY: jwt("service_role"),
      PROD_SUPABASE_SERVICE_ROLE_KEY: jwt("anon"),
      PROD_ROUTE: "usrtimetable.example.workers.dev",
      PROD_SITE_URL: "http://timetable.usr.example.edu/app",
    }),
    opts(),
  );
  assert.equal(result.ok, false);
  const text = result.errors.join("\n");
  assert.match(text, /must equal deploy-production/);
  assert.match(text, /does not match the checked-out commit/);
  assert.match(text, /not a publishable\/anon key/);
  assert.match(text, /not a service-role\/secret key/);
  assert.match(text, /not a platform hostname/);
  assert.match(text, /PROD_SITE_URL must use HTTPS/);
  assert.match(text, /PROD_SITE_URL host must equal PROD_ROUTE/);
  assert.match(text, /without a path/);
});

test("generated config must keep the nitro shape plus nodejs_compat; binding sets name + custom domain", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usr-prod-preflight-"));
  const configPath = path.join(dir, "wrangler.json");
  const generated = { name: "usrtimetable", main: "index.mjs", no_bundle: true, assets: { directory: "../public" } };
  writeFileSync(configPath, JSON.stringify(generated));
  const without = validateProductionEnvironment(safe(), opts({ requireBuild: true, wranglerConfig: configPath }));
  assert.equal(without.ok, false);
  assert.match(without.errors.join("\n"), /nodejs_compat/);

  writeFileSync(configPath, JSON.stringify({ ...generated, compatibility_flags: ["nodejs_compat"] }));
  const ok = validateProductionEnvironment(safe(), opts({ requireBuild: true, wranglerConfig: configPath }));
  assert.equal(ok.ok, true, ok.errors.join("\n"));
  prepareProductionWranglerConfig("usrtimetable", "timetable.usr.example.edu", configPath);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
    ...generated,
    compatibility_flags: ["nodejs_compat"],
    routes: [{ pattern: "timetable.usr.example.edu", custom_domain: true }],
    workers_dev: false,
  });
});

test("staging validation is unchanged: it still does not require nodejs_compat", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usr-staging-unchanged-"));
  const configPath = path.join(dir, "wrangler.json");
  writeFileSync(configPath, JSON.stringify({ main: "index.mjs", no_bundle: true, assets: { directory: "../public" } }));
  const result = validateStagingEnvironment(
    {
      STAGING_DEPLOY_CONFIRM: "DEPLOY_STAGING_ONLY",
      DEPLOY_SHA: "a".repeat(40),
      STAGING_WORKER_NAME: "usrtimetable-staging",
      CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
      CLOUDFLARE_API_TOKEN: "cloudflare-test-token-long-enough",
      STAGING_SUPABASE_PROJECT_ID: "stagingprojectref",
      STAGING_SUPABASE_URL: "https://stagingprojectref.supabase.co",
      STAGING_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
      STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
      STAGING_ADMIN_EMAIL: "a@example.invalid",
      STAGING_ADMIN_PASSWORD: "x",
    },
    { productionRef: PROD_REF, currentSha: "a".repeat(40), requireBuild: true, wranglerConfig: configPath },
  );
  assert.equal(result.ok, true, result.errors.join("\n"));
});

// ---------------------------------------------------------------- smoke check
const goodHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

test("smoke check passes only for 200 with the security headers", () => {
  assert.deepEqual(checkSmokeResponse(200, goodHeaders), []);
  assert.deepEqual(checkSmokeResponse(200, new Headers(goodHeaders)), []);
  assert.match(checkSmokeResponse(500, goodHeaders).join(), /status 500/);
  const { "content-security-policy": _csp, ...noCsp } = goodHeaders;
  assert.match(checkSmokeResponse(200, noCsp).join(), /Content-Security-Policy/);
  assert.match(
    checkSmokeResponse(200, { ...goodHeaders, "x-frame-options": "" }).join(),
    /X-Frame-Options/,
  );
  assert.match(
    checkSmokeResponse(200, { ...goodHeaders, "content-security-policy": "default-src 'self'" }).join(),
    /frame-ancestors/,
  );
});
