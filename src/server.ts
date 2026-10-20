import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  buildSecurityHeaders,
  cspReportOnlyFromEnv,
  mergeSecurityHeaders,
} from "./lib/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function envValue(env: unknown, name: string): string | undefined {
  const fromBinding =
    env && typeof env === "object" ? (env as Record<string, unknown>)[name] : undefined;
  if (typeof fromBinding === "string") return fromBinding;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * M-1: every response (SSR documents, server functions, assets, error pages)
 * carries the security headers. Headers already set by a route are kept.
 */
function withSecurityHeaders(request: Request, env: unknown, response: Response): Response {
  let hostname = "";
  let pathname = "";
  try {
    ({ hostname, pathname } = new URL(request.url));
  } catch {
    hostname = "";
  }
  const headers = buildSecurityHeaders({
    hostname,
    pathname,
    reportOnly: cspReportOnlyFromEnv(envValue(env, "CSP_REPORT_ONLY")),
    supabaseUrl: envValue(env, "SUPABASE_URL"),
  });
  try {
    mergeSecurityHeaders(response.headers, headers);
    return response;
  } catch {
    // Immutable headers (e.g. a passthrough fetch Response): copy once.
    const copy = new Response(response.body, response);
    mergeSecurityHeaders(copy.headers, headers);
    return copy;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(request, env, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        request,
        env,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
