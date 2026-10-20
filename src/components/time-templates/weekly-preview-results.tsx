import { DAY_LABELS_AR, type GeneratedTemplate } from "@/lib/time-templates/weekly-generator";
import { TEMPLATE_SYSTEM_LABELS as SYSTEM_LABELS } from "@/lib/time-templates/template-directory";
import { formatNumber } from "@/lib/format";

export type WeeklyPreviewMeta = {
  selectedDays: number;
  slots120PerDay: number;
  slots180PerDay: number;
  total: number;
  skippedBreakConflicts: number;
  toInsert: number;
  duplicates: number;
  conflicts: number;
  duplicatesInGeneratedBatch: number;
  conflictDetails: Array<GeneratedTemplate & { reason: string }>;
};

/** Weekly template generator preview: counts, blocking conflicts and the first 60 rows. */
export function WeeklyPreviewResults({
  preview,
  previewMeta,
}: {
  preview: GeneratedTemplate[] | null;
  previewMeta: WeeklyPreviewMeta | null;
}) {
  return (
    <>
      {previewMeta && (
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p>الأيام المحددة: {formatNumber(previewMeta.selectedDays)}</p>
          <p>قوالب الساعتين لكل يوم: {formatNumber(previewMeta.slots120PerDay)}</p>
          <p>قوالب الثلاث ساعات لكل يوم: {formatNumber(previewMeta.slots180PerDay)}</p>
          <p>الإجمالي: {formatNumber(previewMeta.total)}</p>
          <p>
            قوالب جديدة: {formatNumber(previewMeta.toInsert)} · موجودة مسبقًا:{" "}
            {formatNumber(previewMeta.duplicates)}
          </p>
          <p>
            متعارضة: {formatNumber(previewMeta.conflicts)} · مكررة داخل المعاينة:{" "}
            {formatNumber(previewMeta.duplicatesInGeneratedBatch)}
          </p>
          <p>متجاوز بسبب استراحة: {formatNumber(previewMeta.skippedBreakConflicts)}</p>
          <p className="text-xs text-muted-foreground md:col-span-2">
            تُراجع القوالب الموجودة قبل الحفظ، ويُضاف الجديد فقط.
          </p>
        </div>
      )}
      {previewMeta && previewMeta.conflictDetails.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">تعارضات تمنع الحفظ:</p>
          <ul className="mt-1 list-disc ps-5">
            {previewMeta.conflictDetails.slice(0, 5).map((c) => (
              <li
                key={`${c.study_system}:${c.day_of_week}:${c.start_time}:${c.end_time}:${c.slot_duration_minutes}`}
              >
                {DAY_LABELS_AR[c.day_of_week]} {c.start_time}–{c.end_time} (
                {c.slot_duration_minutes}د): {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && preview.length > 0 && (
        <div className="max-h-64 overflow-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-2 text-start">اليوم</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
                <th className="p-2 text-start">المدة</th>
                <th className="p-2 text-start">النظام</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 60).map((t) => (
                <tr
                  key={`${t.study_system}:${t.day_of_week}:${t.start_time}:${t.end_time}:${t.slot_duration_minutes}`}
                  className="border-t border-border"
                >
                  <td className="p-2">{DAY_LABELS_AR[t.day_of_week]}</td>
                  <td className="p-2" dir="ltr">
                    {t.start_time}
                  </td>
                  <td className="p-2" dir="ltr">
                    {t.end_time}
                  </td>
                  <td className="p-2">{t.slot_duration_minutes}</td>
                  <td className="p-2">{SYSTEM_LABELS[t.study_system]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.length > 60 && (
            <p className="p-2 text-xs text-muted-foreground">
              عرض أول 60 من {formatNumber(preview.length)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
