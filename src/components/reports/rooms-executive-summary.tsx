import { roomsExecutiveSummary } from "@/lib/reports/rooms-executive";

export function RoomsExecutiveSummary({
  result,
}: {
  result: ReturnType<typeof roomsExecutiveSummary>;
}) {
  return (
    <section
      className="rounded-xl border border-primary/20 bg-primary/5 p-5 print:break-inside-avoid"
      aria-label="فعالية استخدام القاعات والمعامل"
    >
      <p className="text-xs font-semibold text-primary">قراءة تنفيذية</p>
      <h2 className="mt-1 text-lg font-bold text-primary">فعالية استخدام القاعات والمعامل</h2>
      <p className="mt-3 text-sm leading-7">{result.overview}</p>
      {result.opportunities.length > 0 && (
        <div className="mt-4 border-t border-primary/15 pt-3">
          <h3 className="text-sm font-bold">فرص لتحسين توزيع الموارد</h3>
          <ul className="mt-2 list-inside list-disc space-y-2 text-sm leading-7">
            {result.opportunities.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs leading-6 text-muted-foreground">
        مؤشرات وصفية ضمن النسخة والفلاتر المختارة. الوقت غير المستخدم لا يضمن إمكانية النقل؛ يلزم
        فحص التوقيت والنوع والسعة وإشغال النظامين. أعداد الطلاب بيانات تخطيط وليست حضورًا فعليًا.
      </p>
    </section>
  );
}
