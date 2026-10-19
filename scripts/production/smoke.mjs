// Post-deploy smoke check for production (read-only, unauthenticated).
// GET / and /auth must answer 200 (after at most a few same-origin redirects) and carry the
// security headers set by src/server.ts (src/lib/security-headers.ts).
//
// Usage: PROD_BASE_URL=https://timetable.example.edu node scripts/production/smoke.mjs
//   SMOKE_ATTEMPTS (default 10) / SMOKE_DELAY_MS (default 15000): retries while the custom
//   domain and the new Worker version propagate.
import { fileURLToPath } from "node:url";

export const SMOKE_PATHS = ["/", "/auth"];

/** Returns a list of problems for one response (empty = pass). */
export function checkSmokeResponse(status, headers) {
  const get = (name) =>
    typeof headers.get === "function" ? headers.get(name) : headers[name.toLowerCase()];
  const problems = [];
  if (status !== 200) problems.push(`status ${status} (expected 200)`);
  const csp = get("content-security-policy");
  if (!csp) problems.push("missing Content-Security-Policy (enforced mode expected in production)");
  else if (!/frame-ancestors 'none'/.test(csp)) problems.push("CSP lacks frame-ancestors 'none'");
  if (!/max-age=\d{7,}/.test(get("strict-transport-security") ?? ""))
    problems.push("missing/short Strict-Transport-Security");
  if ((get("x-content-type-options") ?? "").toLowerCase() !== "nosniff")
    problems.push("missing X-Content-Type-Options: nosniff");
  if ((get("x-frame-options") ?? "").toUpperCase() !== "DENY")
    problems.push("missing X-Frame-Options: DENY");
  if (!get("referrer-policy")) problems.push("missing Referrer-Policy");
  return problems;
}

async function fetchFollowingSameOrigin(url, maxRedirects = 3) {
  let current = new URL(url);
  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "usrtimetable-prod-smoke" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current);
      if (next.origin !== current.origin)
        throw new Error(`cross-origin redirect to ${next.origin}`);
      current = next;
      continue;
    }
    return { response, finalUrl: current.toString() };
  }
  throw new Error(`more than ${maxRedirects} redirects`);
}

export async function smoke(baseUrl, { attempts = 10, delayMs = 15000, log = console.log } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("PROD_BASE_URL must use HTTPS");
  let lastProblems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastProblems = [];
    for (const path of SMOKE_PATHS) {
      try {
        const { response, finalUrl } = await fetchFollowingSameOrigin(new URL(path, base));
        const problems = checkSmokeResponse(response.status, response.headers);
        log(
          `${path} → ${finalUrl} ${response.status} ${problems.length ? problems.join("; ") : "OK"}`,
        );
        lastProblems.push(...problems.map((p) => `${path}: ${p}`));
      } catch (error) {
        lastProblems.push(`${path}: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (lastProblems.length === 0) return { ok: true, attempt };
    if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, problems: lastProblems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = process.env.PROD_BASE_URL;
  if (!baseUrl) {
    console.error("PROD_BASE_URL is required");
    process.exit(1);
  }
  const result = await smoke(baseUrl, {
    attempts: Number(process.env.SMOKE_ATTEMPTS ?? 10),
    delayMs: Number(process.env.SMOKE_DELAY_MS ?? 15000),
  });
  if (!result.ok) {
    console.error("PRODUCTION SMOKE: FAILED");
    for (const p of result.problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(`PRODUCTION SMOKE: PASS (attempt ${result.attempt})`);
}
