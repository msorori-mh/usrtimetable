import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ReportsCollegeBar } from "@/components/reports/reports-college-bar";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsLayout,
});

function ReportsLayout() {
  return (
    <div className="min-w-0 space-y-4">
      <ReportsCollegeBar />
      <Outlet />
    </div>
  );
}
