import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a QR code as an inline SVG for screen + print. */
export function PrintQrCode(props: {
  value: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const { value, size = 96, className, title = "QR" } = props;
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, {
      type: "svg",
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    }).then((out) => {
      if (!cancelled) setSvg(out);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!value) return null;

  return (
    <div
      className={className}
      title={title}
      aria-label={title}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      style={{ width: size, height: size }}
    />
  );
}
