import { createFileRoute } from "@tanstack/react-router";
import { PrintCenterPage } from "@/components/print-center/print-center-page";

export const Route = createFileRoute("/_authenticated/timetable_/$versionId/print")({
  head: () => ({ meta: [{ title: "مركز الطباعة والتصدير" }] }),
  component: Page,
});

function Page() {
  const { versionId } = Route.useParams();
  return <PrintCenterPage versionId={versionId} />;
}
