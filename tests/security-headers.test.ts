import { describe, expect, test } from "bun:test";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  cspReportOnlyFromEnv,
  isLovablePreviewHost,
  mergeSecurityHeaders,
} from "../src/lib/security-headers";

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return part ? part.slice(name.length + 1).split(" ") : [];
}

describe("M-1 security headers", () => {
  const prod = buildSecurityHeaders({
    hostname: "timetable.example.edu",
    supabaseUrl: "https://abcd.supabase.co",
  });

  test("production responses carry CSP, HSTS, nosniff, referrer and permissions policies", () => {
    expect(prod["Content-Security-Policy"]).toBeDefined();
    expect(prod["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(prod["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(prod["X-Content-Type-Options"]).toBe("nosniff");
    expect(prod["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(prod["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(prod["X-Frame-Options"]).toBe("DENY");
  });

  test("CSP directives restrict sources as specified", () => {
    const csp = prod["Content-Security-Policy"];
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).toContain("'self'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(csp, "script-src").some((s) => s.startsWith("http"))).toBe(false);
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://abcd.supabase.co",
        "wss://abcd.supabase.co",
      ]),
    );
    expect(directive(csp, "style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ]);
    expect(directive(csp, "font-src")).toEqual(["'self'", "https://fonts.gstatic.com", "data:"]);
    expect(directive(csp, "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]));
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
  });

  test("Lovable preview hosts stay frameable by the editor only", () => {
    for (const host of [
      "id-preview--1234abcd-1111-4222-8333-444455556666.lovable.app",
      "my-app.lovable.app",
      "1234abcd-1111-4222-8333-444455556666.lovableproject.com",
    ]) {
      expect(isLovablePreviewHost(host)).toBe(true);
      const headers = buildSecurityHeaders({ hostname: host });
      expect(directive(headers["Content-Security-Policy"], "frame-ancestors")).toEqual([
        "https://*.lovable.app",
        "https://lovable.dev",
        "https://*.lovableproject.com",
      ]);
      expect(headers["X-Frame-Options"]).toBeUndefined();
    }
    for (const host of ["lovable.app.evil.com", "evil-lovable.app", "timetable.example.edu", ""])
      expect(isLovablePreviewHost(host)).toBe(false);
  });

  test("CSP_REPORT_ONLY=1 switches to the report-only header", () => {
    expect(cspReportOnlyFromEnv("1")).toBe(true);
    expect(cspReportOnlyFromEnv(undefined)).toBe(false);
    expect(cspReportOnlyFromEnv("0")).toBe(false);
    const headers = buildSecurityHeaders({ hostname: "x.example.edu", reportOnly: true });
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(
      buildContentSecurityPolicy({ hostname: "x.example.edu" }),
    );
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  test("existing headers are never overwritten", () => {
    const h = new Headers({
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy-Report-Only": "default-src 'none'",
    });
    const added = mergeSecurityHeaders(h, prod);
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Content-Security-Policy")).toBeNull();
    expect(h.get("Content-Security-Policy-Report-Only")).toBe("default-src 'none'");
    expect(added).not.toContain("Referrer-Policy");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("/verify-report keeps no-referrer and noindex at the HTTP layer", () => {
    const headers = buildSecurityHeaders({
      hostname: "timetable.example.edu",
      pathname: "/verify-report",
    });
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(prod["X-Robots-Tag"]).toBeUndefined();
  });

  test("HSTS is not sent to localhost development servers", () => {
    expect(buildSecurityHeaders({ hostname: "localhost" })["Strict-Transport-Security"]).toBe(
      undefined,
    );
  });

  test("an invalid project URL never injects a source", () => {
    const csp = buildContentSecurityPolicy({ hostname: "a.example.edu", supabaseUrl: "javascript:x" });
    expect(csp).not.toContain("javascript");
  });
});
