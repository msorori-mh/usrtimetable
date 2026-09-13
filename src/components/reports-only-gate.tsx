import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveReportsOnlyRedirect, REPORTS_ONLY_HOME } from "@/lib/academic-affairs-role";

/**
 * Route-level scope gate for the academic-affairs role (`institutional_viewer`).
 *
 * A reports-only account may open /reports and /reports/* only. Hiding the
 * navigation is not enough: any other pathname is blocked here and replaced
 * with /reports. Fail-closed: children stay unrendered while the role is
 * unknown or while the redirect is pending.
 *
 * Other roles are untouched, including a user who carries the role together
 * with super_admin or college_admin.
 */
export function ReportsOnlyGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { data: me, isLoading } = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const redirectTo = isLoading ? null : resolveReportsOnlyRedirect(me, pathname);

  useEffect(() => {
    if (redirectTo) void navigate({ to: redirectTo, replace: true });
  }, [redirectTo, navigate]);

  if (isLoading) {
    return (
      <div dir="rtl" className="p-6 text-sm text-muted-foreground" data-testid="role-scope-loading">
        جارٍ التحقق من الصلاحيات…
      </div>
    );
  }

  if (redirectTo) {
    return (
      <div dir="rtl" className="p-6 text-sm text-muted-foreground" data-testid="reports-only-block">
        هذه الصفحة غير متاحة لحساب «إدارة الشؤون الأكاديمية». جارٍ التحويل إلى مركز التقارير…
      </div>
    );
  }

  return <>{children}</>;
}

export { REPORTS_ONLY_HOME };
