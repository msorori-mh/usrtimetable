import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { PrintQrCode } from "@/components/print-center/print-qr-code";
import { PublicReportVerification } from "@/components/reports/public-report-verification";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  params.get("mode") === "qr" ? (
    <PrintQrCode value="https://example.test/reports/instructor-schedule?versionId=276aba86-83ea-4039-8ee2-e08b364a17d0&access_token=SECRET&instructor=PRIVATE#refresh_token=SECRET" />
  ) : (
    <PublicReportVerification receiptId={params.get("ref")} />
  ),
);
