import { createFileRoute } from "@tanstack/react-router";
import { PublicReportVerification } from "@/components/reports/public-report-verification";
import { UUID_PATTERN } from "@/lib/reports/verification-link";

export const Route = createFileRoute("/verify-report")({
  validateSearch: (search: Record<string, unknown>) => ({
    ref: typeof search.ref === "string" && UUID_PATTERN.test(search.ref) ? search.ref : undefined,
  }),
  head: () => ({
    meta: [
      { title: "التحقق من التقرير — جامعة إقليم سبأ" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: VerificationPage,
});
function VerificationPage() {
  const { ref } = Route.useSearch();
  return <PublicReportVerification receiptId={ref ?? null} />;
}
