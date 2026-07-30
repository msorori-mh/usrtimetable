import { AlertTriangle } from "lucide-react";
import {
  DELIVERY_DEMO_WARNING_AR,
  isDeliveryDemoVersion,
} from "@/lib/schedule-versions/delivery-demo";

export function DeliveryDemoWarningBanner(props: {
  name?: string | null;
  notes?: string | null;
}) {
  if (!isDeliveryDemoVersion(props)) return null;
  return (
    <div
      data-testid="delivery-demo-warning-banner"
      role="alert"
      className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-950 dark:text-amber-50"
      dir="rtl"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-semibold">تحذير نسخة التسليم التجريبية</div>
          <p className="mt-1 leading-relaxed">{DELIVERY_DEMO_WARNING_AR}</p>
        </div>
      </div>
    </div>
  );
}
