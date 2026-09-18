import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { publicVerificationUrl, reportVerificationSource } from "@/lib/reports/verification-link";
import { issueReportVerification } from "@/lib/reports/verification-api";

/** Print QR codes always open the isolated metadata page, never an internal report. */
export function PrintQrCode(props: {
  value: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const { value, size = 96, className, title = "التحقق من التقرير" } = props;
  const [image, setImage] = useState<{ source: string; svg: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!value) return;
    const source = reportVerificationSource(value);
    const origin = window.location.origin;
    const render = async (receiptId?: string | null) => {
      const url = publicVerificationUrl(origin, receiptId);
      const svg = await QRCode.toString(url, {
        type: "svg",
        margin: 1,
        width: size,
        errorCorrectionLevel: "M",
      });
      if (!cancelled) setImage({ source: value, svg, url });
    };
    void (async () => {
      // Safe placeholder while issuing: even an immediate print cannot encode an internal link.
      await render();
      if (source.versionId) {
        const receipt = await issueReportVerification(source.versionId, source.kind);
        if (!cancelled && receipt) await render(receipt);
      }
    })().catch(() => {
      // Keep the non-sensitive verification landing page on unavailable/private reports.
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  if (!value) return null;
  const current = image?.source === value ? image : null;
  return (
    <div
      className={className}
      title={title}
      aria-label={title}
      data-verification-url={current?.url}
      dangerouslySetInnerHTML={current ? { __html: current.svg } : undefined}
      style={{ width: size, height: size }}
    />
  );
}
