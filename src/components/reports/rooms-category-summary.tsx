import { roomsReportTotals, type RoomsReportSummaryRow } from "@/lib/print-center/rooms-report";

/** Uses the same inventory and filtered hours as the overall report. */
export function RoomsCategorySummary({ summary }: { summary: RoomsReportSummaryRow[] }) {
  return (
    <section
      className="my-3 grid gap-3 sm:grid-cols-2 print:grid-cols-2"
      aria-label="ملخص القاعات والمعامل حسب النوع"
    >
      {(["hall", "lab"] as const).map((category) => {
        const rows = summary.filter((row) => row.room_category === category);
        const totals = roomsReportTotals({ summary: rows, sessions: [] });
        const complete = rows.length > 0 && rows.every((row) => row.available_hours > 0);
        const metrics = [
          ["العدد", totals.rooms],
          ["المجدول في نسخة الكلية", totals.scheduledHours],
          ["المستخدم داخل الإتاحة", totals.usedHours],
          ["الإتاحة المعتمدة", complete ? totals.availableHours : "—"],
          ["غير المشغول داخل الإتاحة", complete ? totals.freeHours : "—"],
          ["خارج الإتاحة", totals.outsideHours],
          ["نسبة الاستغلال", complete ? `${totals.utilization}%` : "—"],
          ["عدد المحاضرات", rows.reduce((sum, row) => sum + row.session_count, 0)],
        ];
        return (
          <div key={category} className="rounded-lg border bg-card p-4 print:break-inside-avoid">
            <h3 className="mb-3 font-bold text-primary">
              {category === "hall" ? "قاعات المحاضرات" : "المعامل"}
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
              {metrics.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {totals.outsideHours > 0 && (
              <p className="mt-3 text-xs text-destructive">
                {totals.outsideHours} ساعة مجدولة خارج الإتاحة؛ لا تدخل في نسبة الاستغلال.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
