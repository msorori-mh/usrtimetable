/**
 * M-1: security headers for every response served by src/server.ts.
 * Pure module (no imports) so the policy is unit-testable.
 *
 * script-src keeps 'unsafe-inline': TanStack Start's <Scripts /> streams inline
 * dehydration/bootstrap scripts without a per-request nonce wired through this
 * custom server entry, and the static error page uses an inline handler.
 * 'wasm-unsafe-eval' is required by the HiGHS solver (WebAssembly) and is far
 * narrower than 'unsafe-eval'.
 */

export type SecurityHeaderOptions = {
  hostname: string;
  /** Request path; /verify-report gets no-referrer + noindex at the HTTP layer too. */
  pathname?: string;
  /** CSP_REPORT_ONLY=1 → Content-Security-Policy-Report-Only. */
  reportOnly?: boolean;
  /** Project URL (SUPABASE_URL); its origin is added to connect-src explicitly. */
  supabaseUrl?: string | null;
};

const LOVABLE_FRAME_ANCESTORS = [
  "https://*.lovable.app",
  "https://lovable.dev",
  "https://*.lovableproject.com",
];

/** Lovable editor preview surfaces must stay frameable by the editor only. */
export function isLovablePreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return (
    host.endsWith(".lovable.app") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host.startsWith("id-preview--")
  );
}

/** The public report-verification page must never leak its receipt id via Referer. */
export function isPublicVerificationPath(pathname: string | undefined): boolean {
  return pathname === "/verify-report" || pathname === "/verify-report/";
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function supabaseOrigins(url: string | null | undefined): string[] {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return [];
    return [parsed.origin, `wss://${parsed.host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
  const preview = isLovablePreviewHost(options.hostname);
  const connect = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    ...supabaseOrigins(options.supabaseUrl),
    "data:",
    "blob:",
  ];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    ],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["font-src", ["'self'", "https://fonts.gstatic.com", "data:"]],
    ["img-src", ["'self'", "data:", "blob:", "https://*.supabase.co"]],
    ["connect-src", [...new Set(connect)]],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", ["'self'", "blob:", "data:"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", preview ? LOVABLE_FRAME_ANCESTORS : ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    [options.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"]:
      buildContentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": isPublicVerificationPath(options.pathname)
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (!isLocalHost(options.hostname))
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  if (isPublicVerificationPath(options.pathname)) headers["X-Robots-Tag"] = "noindex, nofollow";
  // Legacy clickjacking protection for browsers without frame-ancestors.
  if (!isLovablePreviewHost(options.hostname)) headers["X-Frame-Options"] = "DENY";
  return headers;
}

/**
 * Adds every header that is not already present (a route-specific value —
 * e.g. a stricter Referrer-Policy — always wins). Returns the names added.
 */
export function mergeSecurityHeaders(
  target: { has(name: string): boolean; set(name: string, value: string): void },
  headers: Record<string, string>,
): string[] {
  const added: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (target.has(name)) continue;
    // Either CSP mode already present counts as "CSP set by the route".
    if (
      (name === "Content-Security-Policy" || name === "Content-Security-Policy-Report-Only") &&
      (target.has("Content-Security-Policy") || target.has("Content-Security-Policy-Report-Only"))
    )
      continue;
    target.set(name, value);
    added.push(name);
  }
  return added;
}

export function cspReportOnlyFromEnv(value: string | undefined | null): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
