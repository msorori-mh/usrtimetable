export function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Preview hosts need their editor iframe. Production is never embeddable.
  const url = new URL(request.url);
  if (url.hostname === "gomufadhala.com" || url.hostname === "www.gomufadhala.com") {
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  if ((headers.get("content-type") ?? "").includes("text/html") || request.method !== "GET") {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
