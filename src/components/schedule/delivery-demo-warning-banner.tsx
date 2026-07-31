import { AlertTriangle } from "lucide-react";
import {
  DELIVERY_DEMO_WARNING_AR,
  isDemoOrTestClassification,
  shouldBlockOperationalApprovalMessaging,
  type ClassificationSource,
} from "@/lib/schedule-versions/data-classification";

/** Warning when version is demo/test (column or DELIVERY_DEMO markers). */
export function DeliveryDemoWarningBanner(props: ClassificationSource) {
  if (!isDemoOrTestClassification(props)) return null;
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

/**
 * UI-only banner: blocks “operational approval” messaging for demo/test.
 * Does not implement convert-to-operational; official path is a future stub.
 */
export function NonOperationalApprovalBanner(props: ClassificationSource) {
  if (!shouldBlockOperationalApprovalMessaging(props)) return null;
  return (
    <div
      data-testid="non-operational-approval-banner"
      role="status"
      className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-950 dark:text-rose-50"
      dir="rtl"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-semibold">ليست بيانات تشغيلية رسمية</div>
          <p className="mt-1 leading-relaxed">
            هذه النسخة مصنّفة كـ Demo/Test. لا يُعرض مسار «اعتماد تشغيلي» هنا. تحويل التصنيف إلى
            Operational يتطلب مسارًا رسميًا معتمدًا لاحقًا (غير مفعّل في هذه المرحلة).
          </p>
        </div>
      </div>
    </div>
  );
}
