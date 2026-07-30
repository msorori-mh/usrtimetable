/** Markers for final delivery / demo schedule versions (not operational). */
export const DELIVERY_DEMO_MARKER = "DELIVERY_DEMO";

export const DELIVERY_DEMO_WARNING_AR =
  "بيانات افتراضية لأغراض التسليم والاختبار فقط — غير صالحة للاستخدام الأكاديمي التشغيلي. يجب استبدالها قبل بدء التشغيل الحقيقي.";

export function isDeliveryDemoVersion(input: {
  name?: string | null;
  notes?: string | null;
}): boolean {
  const blob = `${input.name ?? ""}\n${input.notes ?? ""}`;
  if (!blob.trim()) return false;
  return (
    blob.includes(DELIVERY_DEMO_MARKER) ||
    blob.includes("التسليم التجريبية") ||
    blob.includes("بيانات افتراضية") ||
    /delivery\s*demo/i.test(blob)
  );
}
