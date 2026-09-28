import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATED_WRANGLER_CONFIG = path.join(ROOT, ".output/server/wrangler.json");
const REQUIRED_CONFIRMATION = "DEPLOY_STAGING_ONLY";

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

function checkedOutSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
