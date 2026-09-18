import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { ReportsCollegeBar } from "@/components/reports/reports-college-bar";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsLayout,
});

function ReportsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-w-0 space-y-4">
      {pathname !== "/reports/leadership" && <ReportsCollegeBar />}
      <Outlet />
    </div>
  );
}
