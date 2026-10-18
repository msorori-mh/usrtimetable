// Neutral client-side error reporting for React/TanStack error boundaries.
//
// Always logs to the console with the current route. An external monitoring tool can be
// attached later without code changes by assigning `window.__appErrorReporter` (e.g. from an
// inline script or a tag manager): it receives the error, a context object and options.

export type AppErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

export type AppErrorReporter = (
  error: unknown,
  context: Record<string, unknown>,
  options: AppErrorOptions,
) => void;

declare global {
  interface Window {
    __appErrorReporter?: AppErrorReporter;
  }
}

export function reportAppError(
  error: unknown,
  context: Record<string, unknown> = {},
  options: AppErrorOptions = {},
): void {
  if (typeof window === "undefined") return;
  const fullContext = {
    source: "react_error_boundary",
    route: window.location.pathname,
    ...context,
  };
  const fullOptions: AppErrorOptions = {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
    ...options,
  };
  console.error("[app-error]", fullContext, error);
  const reporter = window.__appErrorReporter;
  if (typeof reporter !== "function") return;
  try {
    reporter(error, fullContext, fullOptions);
  } catch (hookError) {
    // A broken external reporter must never break the error boundary itself.
    console.error("[app-error] reporter hook failed", hookError);
  }
}
