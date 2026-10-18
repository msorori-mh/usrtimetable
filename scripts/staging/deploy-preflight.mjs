import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATED_WRANGLER_CONFIG = path.join(ROOT, ".output/server/wrangler.json");
const REQUIRED_CONFIRMATION = "DEPLOY_STAGING_ONLY";
const PRODUCTION_CONFIRMATION = "deploy-production";
// The former Lovable Cloud-managed project. Production must never target it again after the
// Lovable exit (docs/operations/lovable-exit-runbook.md); it stays read-only as a rollback.
export const LEGACY_LOVABLE_PROJECT_REF = "emzytxqkxjjhsivqxdiu"; // deny-guard: refused, never targeted

function required(env, name, errors) {
  const value = String(env[name] ?? "").trim();
  if (!value) errors.push(`${name} is required`);
  return value;
}

function jwtRole(value) {
  if (value.startsWith("sb_publishable_")) return "anon";
  if (value.startsWith("sb_secret_")) return "service_role";
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

export function productionProjectRef(root = ROOT) {
  const source = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const match = source.match(/^project_id\s*=\s*["']([^"']+)["']/m);
  if (!match) throw new Error("supabase/config.toml does not declare project_id");
  return match[1];
}

export function validateStagingEnvironment(env, options = {}) {
  const root = options.root ?? ROOT;
  const errors = [];
  const productionRef = options.productionRef ?? productionProjectRef(root);
  const confirmation = required(env, "STAGING_DEPLOY_CONFIRM", errors);
  const deploySha = required(env, "DEPLOY_SHA", errors);
  const workerName = required(env, "STAGING_WORKER_NAME", errors);
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID", errors);
  const apiToken = required(env, "CLOUDFLARE_API_TOKEN", errors);
  const projectRef = required(env, "STAGING_SUPABASE_PROJECT_ID", errors);
  const supabaseUrl = required(env, "STAGING_SUPABASE_URL", errors);
  const publishableKey = required(env, "STAGING_SUPABASE_PUBLISHABLE_KEY", errors);
  const serviceRoleKey = required(env, "STAGING_SUPABASE_SERVICE_ROLE_KEY", errors);
  required(env, "STAGING_ADMIN_EMAIL", errors);
  required(env, "STAGING_ADMIN_PASSWORD", errors);

  if (confirmation && confirmation !== REQUIRED_CONFIRMATION)
    errors.push(`STAGING_DEPLOY_CONFIRM must equal ${REQUIRED_CONFIRMATION}`);
  if (deploySha && !/^[0-9a-f]{40}$/i.test(deploySha))
    errors.push("DEPLOY_SHA must be a full 40-character commit SHA");
  if (options.currentSha && deploySha && options.currentSha !== deploySha)
    errors.push("DEPLOY_SHA does not match the checked-out commit");
  if (
    workerName &&
    (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(workerName) || !workerName.includes("staging"))
  )
    errors.push("STAGING_WORKER_NAME must be a valid Cloudflare name containing 'staging'");
  if (accountId && !/^[0-9a-f]{32}$/i.test(accountId))
    errors.push("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account id");
  if (apiToken && apiToken.length < 20) errors.push("CLOUDFLARE_API_TOKEN is not plausible");
  if (projectRef && projectRef === productionRef)
    errors.push("STAGING_SUPABASE_PROJECT_ID matches the production project");
  if (env.PRODUCTION_SUPABASE_PROJECT_ID && projectRef === env.PRODUCTION_SUPABASE_PROJECT_ID)
    errors.push("Staging and production Supabase project ids must differ");

  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      if (parsed.protocol !== "https:") errors.push("STAGING_SUPABASE_URL must use HTTPS");
      if (projectRef && parsed.hostname !== `${projectRef}.supabase.co`)
        errors.push("STAGING_SUPABASE_URL host does not match STAGING_SUPABASE_PROJECT_ID");
      if (parsed.hostname === `${productionRef}.supabase.co`)
        errors.push("STAGING_SUPABASE_URL resolves to the production project");
    } catch {
      errors.push("STAGING_SUPABASE_URL is not a valid URL");
    }
  }

  const publicRole = jwtRole(publishableKey);
  if (publishableKey && publicRole !== "anon")
    errors.push("STAGING_SUPABASE_PUBLISHABLE_KEY is not a publishable/anon key");
  const serviceRole = jwtRole(serviceRoleKey);
  if (serviceRoleKey && serviceRole !== "service_role")
    errors.push("STAGING_SUPABASE_SERVICE_ROLE_KEY is not a service-role/secret key");
  if (publishableKey && serviceRoleKey && publishableKey === serviceRoleKey)
    errors.push("Publishable and service-role keys must differ");

  if (env.STAGING_BASE_URL) {
    try {
      const parsed = new URL(env.STAGING_BASE_URL);
      if (parsed.protocol !== "https:") errors.push("STAGING_BASE_URL must use HTTPS");
      if (["gomufadhala.com", "www.gomufadhala.com"].includes(parsed.hostname))
        errors.push("STAGING_BASE_URL points to the production hostname");
    } catch {
      errors.push("STAGING_BASE_URL is not a valid URL");
    }
  }

  if (options.requireBuild) {
    try {
      const config = JSON.parse(
        readFileSync(options.wranglerConfig ?? GENERATED_WRANGLER_CONFIG, "utf8"),
      );
      if (config.main !== "index.mjs") errors.push("Generated Wrangler main must be index.mjs");
      if (config.no_bundle !== true)
        errors.push("Generated Wrangler config must retain no_bundle=true");
      if (config.assets?.directory !== "../public")
        errors.push("Generated Wrangler assets directory must be ../public");
    } catch (error) {
      errors.push(
        `Generated Wrangler config is unavailable: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      deploySha,
      workerName,
      projectRef,
      productionRef,
      buildChecked: Boolean(options.requireBuild),
    },
  };
}

export function prepareGeneratedWranglerConfig(workerName, configPath = GENERATED_WRANGLER_CONFIG) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.name = workerName;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function validateGeneratedWranglerConfig(configPath, errors, { requireNodeCompat = false } = {}) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.main !== "index.mjs") errors.push("Generated Wrangler main must be index.mjs");
    if (config.no_bundle !== true)
      errors.push("Generated Wrangler config must retain no_bundle=true");
    if (config.assets?.directory !== "../public")
      errors.push("Generated Wrangler assets directory must be ../public");
    if (requireNodeCompat && !(config.compatibility_flags ?? []).includes("nodejs_compat"))
      errors.push("Generated Wrangler config must enable the nodejs_compat compatibility flag");
    // process.env is populated from Worker secrets only from this compatibility date on.
    if (
      requireNodeCompat &&
      !(typeof config.compatibility_date === "string" && config.compatibility_date >= "2025-04-01")
    )
      errors.push("Generated Wrangler compatibility_date must be 2025-04-01 or later");
  } catch (error) {
    errors.push(
      `Generated Wrangler config is unavailable: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Production mode (.github/workflows/deploy-production.yml). Mirrors the staging guard but
 * binds the deployment to the university-owned production project declared in
 * supabase/config.toml, a production Worker name and a custom-domain route.
 */
export function validateProductionEnvironment(env, options = {}) {
  const root = options.root ?? ROOT;
  const errors = [];
  const productionRef = options.productionRef ?? productionProjectRef(root);
  const confirmation = required(env, "PRODUCTION_DEPLOY_CONFIRM", errors);
  const deploySha = required(env, "DEPLOY_SHA", errors);
  const workerName = required(env, "PROD_WORKER_NAME", errors);
  const route = required(env, "PROD_ROUTE", errors).toLowerCase();
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID", errors);
  const apiToken = required(env, "CLOUDFLARE_API_TOKEN", errors);
  const projectRef = required(env, "PROD_SUPABASE_PROJECT_ID", errors);
  const supabaseUrl = required(env, "PROD_SUPABASE_URL", errors);
  const publishableKey = required(env, "PROD_SUPABASE_PUBLISHABLE_KEY", errors);
  const serviceRoleKey = required(env, "PROD_SUPABASE_SERVICE_ROLE_KEY", errors);
  const siteUrl = required(env, "PROD_SITE_URL", errors);

  if (confirmation && confirmation !== PRODUCTION_CONFIRMATION)
    errors.push(`PRODUCTION_DEPLOY_CONFIRM must equal ${PRODUCTION_CONFIRMATION}`);
  if (deploySha && !/^[0-9a-f]{40}$/i.test(deploySha))
    errors.push("DEPLOY_SHA must be a full 40-character commit SHA");
  if (options.currentSha && deploySha && options.currentSha !== deploySha)
    errors.push("DEPLOY_SHA does not match the checked-out commit");
  if (
    workerName &&
    (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(workerName) || /staging|preview|test/.test(workerName))
  )
    errors.push(
      "PROD_WORKER_NAME must be a valid Cloudflare name without 'staging', 'preview' or 'test'",
    );
  if (route && !HOSTNAME.test(route))
    errors.push("PROD_ROUTE must be a bare custom-domain hostname (e.g. timetable.example.edu)");
  if (route && /\.workers\.dev$|\.pages\.dev$|lovable/.test(route))
    errors.push("PROD_ROUTE must be the university custom domain, not a platform hostname");
  if (accountId && !/^[0-9a-f]{32}$/i.test(accountId))
    errors.push("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account id");
  if (apiToken && apiToken.length < 20) errors.push("CLOUDFLARE_API_TOKEN is not plausible");

  if (projectRef && projectRef === LEGACY_LOVABLE_PROJECT_REF)
    errors.push("PROD_SUPABASE_PROJECT_ID is the legacy Lovable Cloud project");
  if (productionRef === LEGACY_LOVABLE_PROJECT_REF)
    errors.push(
      "supabase/config.toml project_id still names the legacy Lovable Cloud project; set it to the university project ref",
    );
  if (projectRef && projectRef !== productionRef)
    errors.push("PROD_SUPABASE_PROJECT_ID must equal project_id in supabase/config.toml");
  if (env.STAGING_SUPABASE_PROJECT_ID && projectRef === env.STAGING_SUPABASE_PROJECT_ID)
    errors.push("Staging and production Supabase project ids must differ");

  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      if (parsed.protocol !== "https:") errors.push("PROD_SUPABASE_URL must use HTTPS");
      if (projectRef && parsed.hostname !== `${projectRef}.supabase.co`)
        errors.push("PROD_SUPABASE_URL host does not match PROD_SUPABASE_PROJECT_ID");
      if (parsed.hostname === `${LEGACY_LOVABLE_PROJECT_REF}.supabase.co`)
        errors.push("PROD_SUPABASE_URL resolves to the legacy Lovable Cloud project");
    } catch {
      errors.push("PROD_SUPABASE_URL is not a valid URL");
    }
  }

  const publicRole = jwtRole(publishableKey);
  if (publishableKey && publicRole !== "anon")
    errors.push("PROD_SUPABASE_PUBLISHABLE_KEY is not a publishable/anon key");
  const serviceRole = jwtRole(serviceRoleKey);
  if (serviceRoleKey && serviceRole !== "service_role")
    errors.push("PROD_SUPABASE_SERVICE_ROLE_KEY is not a service-role/secret key");
  if (publishableKey && serviceRoleKey && publishableKey === serviceRoleKey)
    errors.push("Publishable and service-role keys must differ");

  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      if (parsed.protocol !== "https:") errors.push("PROD_SITE_URL must use HTTPS");
      if (route && parsed.hostname !== route)
        errors.push("PROD_SITE_URL host must equal PROD_ROUTE");
      if (parsed.pathname !== "/" || parsed.search || parsed.hash)
        errors.push("PROD_SITE_URL must be an origin without a path");
    } catch {
      errors.push("PROD_SITE_URL is not a valid URL");
    }
  }

  if (options.requireBuild)
    validateGeneratedWranglerConfig(options.wranglerConfig ?? GENERATED_WRANGLER_CONFIG, errors, {
      requireNodeCompat: true,
    });

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      mode: "production",
      deploySha,
      workerName,
      route,
      projectRef,
      buildChecked: Boolean(options.requireBuild),
    },
  };
}

/** Bind the generated config to the production Worker and its custom domain only. */
export function prepareProductionWranglerConfig(
  workerName,
  route,
  configPath = GENERATED_WRANGLER_CONFIG,
) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.name = workerName;
  config.routes = [{ pattern: route, custom_domain: true }];
  // Serve production only on the custom domain, never on <name>.<account>.workers.dev.
  config.workers_dev = false;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function checkedOutSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function runProductionCli() {
  const requireBuild = process.env.PRODUCTION_REQUIRE_BUILD === "1";
  const result = validateProductionEnvironment(process.env, {
    root: ROOT,
    currentSha: checkedOutSha(),
    requireBuild,
  });
  if (!result.ok) {
    console.error("PRODUCTION PREFLIGHT: BLOCKED");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--prepare-build-config"))
    prepareProductionWranglerConfig(result.summary.workerName, result.summary.route);
  console.log(
    JSON.stringify({ decision: "PASS", ...result.summary, secrets: "validated but not printed" }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--production")) {
  runProductionCli();
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const requireBuild = process.env.STAGING_REQUIRE_BUILD === "1";
  const result = validateStagingEnvironment(process.env, {
    root: ROOT,
    currentSha: checkedOutSha(),
    requireBuild,
  });
  if (!result.ok) {
    console.error("STAGING PREFLIGHT: BLOCKED");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    if (process.argv.includes("--prepare-build-config"))
      prepareGeneratedWranglerConfig(result.summary.workerName);
    console.log(
      JSON.stringify({ decision: "PASS", ...result.summary, secrets: "validated but not printed" }),
    );
  }
}
