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
        const metrics = [
          ["العدد", totals.rooms],
          ["الساعات المستخدمة", totals.usedHours],
          ["الساعات المتاحة", totals.availableHours],
          ["غير مستخدمة في النطاق", totals.freeHours],
          ["نسبة الاستغلال", totals.availableHours > 0 ? `${totals.utilization}%` : "—"],
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
            {totals.overbookedHours > 0 && (
              <p className="mt-3 text-xs text-destructive">
                تجاوز الإتاحة: {totals.overbookedHours} ساعة
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
