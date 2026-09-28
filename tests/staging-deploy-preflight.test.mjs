import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareGeneratedWranglerConfig,
  validateStagingEnvironment,
} from "../scripts/staging/deploy-preflight.mjs";

const jwt = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature-for-contract-test`;
};

const safe = (overrides = {}) => ({
  STAGING_DEPLOY_CONFIRM: "DEPLOY_STAGING_ONLY",
  DEPLOY_SHA: "a".repeat(40),
  STAGING_WORKER_NAME: "usrtimetable-pr-344-staging",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "cloudflare-test-token-long-enough",
  STAGING_SUPABASE_PROJECT_ID: "stagingprojectref",
  STAGING_SUPABASE_URL: "https://stagingprojectref.supabase.co",
  STAGING_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
  STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  STAGING_ADMIN_EMAIL: "staging-admin@example.invalid",
  STAGING_ADMIN_PASSWORD: "test-only-password",
  ...overrides,
});

test("accepts only an explicitly confirmed and isolated staging target", () => {
  const result = validateStagingEnvironment(safe(), {
    productionRef: "productionprojectref",
    currentSha: "a".repeat(40),
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.projectRef, "stagingprojectref");
});

test("rejects production Supabase, production hostname, and a non-staging Worker", () => {
  const result = validateStagingEnvironment(
    safe({
      STAGING_WORKER_NAME: "usrtimetable",
      STAGING_SUPABASE_PROJECT_ID: "productionprojectref",
      STAGING_SUPABASE_URL: "https://productionprojectref.supabase.co",
      STAGING_BASE_URL: "https://gomufadhala.com",
    }),
    { productionRef: "productionprojectref", currentSha: "a".repeat(40) },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /matches the production project/);
  assert.match(result.errors.join("\n"), /containing 'staging'/);
  assert.match(result.errors.join("\n"), /production hostname/);
});

test("rejects missing confirmation, SHA drift, and swapped Supabase keys", () => {
  const result = validateStagingEnvironment(
    safe({
      STAGING_DEPLOY_CONFIRM: "yes",
      DEPLOY_SHA: "c".repeat(40),
      STAGING_SUPABASE_PUBLISHABLE_KEY: jwt("service_role"),
      STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt("anon"),
    }),
    { productionRef: "productionprojectref", currentSha: "a".repeat(40) },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /DEPLOY_STAGING_ONLY/);
  assert.match(result.errors.join("\n"), /does not match the checked-out commit/);
  assert.match(result.errors.join("\n"), /not a publishable\/anon key/);
  assert.match(result.errors.join("\n"), /not a service-role\/secret key/);
});

test("validates and rewrites only the generated Worker name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usr-staging-preflight-"));
  const configPath = path.join(dir, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "generated-name",
      main: "index.mjs",
      no_bundle: true,
      assets: { directory: "../public" },
    }),
  );
  const result = validateStagingEnvironment(safe(), {
    productionRef: "productionprojectref",
    currentSha: "a".repeat(40),
    requireBuild: true,
    wranglerConfig: configPath,
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  prepareGeneratedWranglerConfig("usrtimetable-pr-344-staging", configPath);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
    name: "usrtimetable-pr-344-staging",
    main: "index.mjs",
    no_bundle: true,
    assets: { directory: "../public" },
  });
});
