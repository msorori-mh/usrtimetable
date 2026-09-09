import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/app-layout";

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

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) {
        void navigate({ to: "/auth", replace: true });
        return;
      }
      setAllowed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Hydration render: must produce exactly what the server produced (nothing).
  if (!hydrated) return null;

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

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
