import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/app-layout";
import { ReportsOnlyGate } from "@/components/reports-only-gate";
import { MandatoryPasswordChange } from "@/components/mandatory-password-change";
import { SessionCheckError } from "@/lib/auth/check-session";
import { checkCurrentSession } from "@/lib/auth/session-service";

/**
 * LAUNCH-CLOSURE-01 — hydration-safe client auth gate.
 *
 * Previous shape: this client-only subtree gated access in a pre-render router
 * hook that threw a redirect to /auth. The router resolved that redirect BEFORE
 * the first client render, so an unauthenticated hit on /dashboard produced:
 *   server HTML         = empty (subtree is client-only)
 *   first client render = the fully rendered /auth tree
 * React then reported hydration error #418 ("server rendered HTML didn't match
 * the client") and discarded the whole root tree.
 *
 * Fix: keep the subtree client-only, but make the FIRST client render identical
 * to the server output (nothing at all), then resolve the session in an effect
 * after hydration. The redirect becomes an ordinary client navigation that
 * happens outside hydration. No warnings are muted and no error is swallowed.
 *
 * Security note: this is a UX gate only. Authorization is enforced by database
 * row-level security (`can_manage_college` / `can_view_college`) on every table
 * and function; college isolation is unchanged by this file.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  /** False during the hydration render so client output matches the empty SSR shell. */
  const [hydrated, setHydrated] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  /** Set when the session request itself failed (offline / server unreachable). */
  const [checkFailed, setCheckFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // A stalled service must produce a retryable failure, never cached access.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setAllowed(false);
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        cancelled = true;
        controller.abort();
        setAllowed(false);
        setCheckFailed(null);
        void navigate({ to: "/auth", replace: true });
      }
    });
    void checkCurrentSession(controller.signal)
      .then((result) => {
        if (cancelled) return;
        if (result.kind === "signed-out" || result.mfaRequired) {
          void navigate({ to: "/auth", replace: true });
          return;
        }
        setPasswordRequired(result.passwordRequired);
        setCheckFailed(null);
        setAllowed(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAllowed(false);
        setCheckFailed(
          e instanceof SessionCheckError ? e.message : "تعذّر الوصول إلى خدمة الجلسات",
        );
      });
    return () => {
      cancelled = true;
      controller.abort();
      data.subscription.unsubscribe();
    };
  }, [navigate, attempt]);

  // Hydration render: must produce exactly what the server produced (nothing).
  if (!hydrated) return null;

  if (checkFailed) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center"
        data-testid="auth-gate-error"
      >
        <p className="text-sm font-medium text-destructive">
          تعذّر التحقق من الجلسة: {checkFailed}
        </p>
        <p className="text-xs text-muted-foreground">
          لم يتم منح الوصول. تحقّق من الاتصال ثم أعد المحاولة.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="auth-gate-retry"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setCheckFailed(null);
              setAttempt((n) => n + 1);
            }}
          >
            إعادة المحاولة
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void navigate({ to: "/auth", replace: true })}
          >
            الانتقال إلى تسجيل الدخول
          </button>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen items-center justify-center bg-background px-4"
        data-testid="auth-gate-resolving"
      >
        <p className="text-sm text-muted-foreground">جارٍ التحقق من الجلسة…</p>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <MandatoryPasswordChange
        onComplete={() => {
          setAllowed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <AppLayout>
      <ReportsOnlyGate>
        <Outlet />
      </ReportsOnlyGate>
    </AppLayout>
  );
}
