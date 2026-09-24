import type { summarizeUniversitySchedule } from "@/lib/reports/university-instructor-schedule";

export function InstructorCollegeHours({
  summary,
  hourlyContract = false,
  universityScope = true,
}: {
  summary: ReturnType<typeof summarizeUniversitySchedule>;
  hourlyContract?: boolean;
  universityScope?: boolean;
}) {
  const number = (n: number | null) => (n === null ? "غير محدد" : n.toFixed(2));
  return (
    <section
      className="break-inside-avoid rounded-lg border p-3 print:bg-white"
      aria-label="ملخص ساعات المحاضر حسب الكلية"
      data-testid="instructor-college-hours"
    >
      <h2 className="mb-2 text-base font-bold">ملخص الساعات التدريسية الأسبوعية</h2>
      <table className="w-full text-sm" dir="rtl">
        <thead>
          <tr>
            <th className="p-2 text-right">الكلية</th>
            <th className="p-2 text-right">نسخة الجدول</th>
            <th className="p-2 text-right">الساعات</th>
          </tr>
        </thead>
        <tbody>
          {summary.colleges.map((c) => (
            <tr key={c.collegeId} className="border-t">
              <td className="p-2">{c.collegeName}</td>
              <td className="p-2">{c.versionName}</td>
              <td className="p-2 tabular-nums">{number(c.hours)}</td>
            </tr>
          ))}
          <tr className="border-t font-bold">
            <td className="p-2" colSpan={2}>
              {universityScope
                ? "إجمالي الجامعة — الكليات المشمولة"
                : "إجمالي ساعات الكلية الحالية"}
            </td>
            <td className="p-2 tabular-nums">{number(summary.totalHours)}</td>
          </tr>
          {!hourlyContract && (
            <>
              <tr>
                <td className="p-2" colSpan={2}>
                  النصاب الأساسي
                </td>
                <td className="p-2">{number(summary.balance.baseHours)}</td>
              </tr>
              <tr>
                <td className="p-2" colSpan={2}>
                  الإعفاء الإداري
                </td>
                <td className="p-2">{number(summary.balance.releaseHours)}</td>
              </tr>
              <tr>
                <td className="p-2" colSpan={2}>
                  النصاب الفعلي بعد الإعفاء
                </td>
                <td className="p-2">{number(summary.balance.netHours)}</td>
              </tr>
            </>
          )}
          <tr className="border-t font-bold">
            <td className="p-2" colSpan={2}>
              الساعات الزائدة
            </td>
            <td className="p-2">
              {hourlyContract
                ? "لا ينطبق — تعاقد بالساعات"
                : !universityScope
                  ? "يُحدد في تقرير الأدمن الموحّد"
                  : summary.pending
                    ? "بانتظار توزيع التدريس المشترك"
                    : number(summary.balance.overloadHours)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs">
        {universityScope
          ? "يشمل جميع أنظمة الدراسة في نسخ الكليات المبينة أعلاه. يُحتسب النصاب مرة واحدة للمحاضر."
          : "هذا الملخص خاص بالكلية الحالية؛ الإجمالي الجامعي والساعات الزائدة متاحان للأدمن في التقرير الموحّد."}
      </p>
      {!hourlyContract && summary.balance.netHours === null && (
        <p className="mt-1 text-xs">الساعات الزائدة بانتظار استكمال بيانات النصاب المعتمد.</p>
      )}
      {summary.pending && (
        <p className="mt-1 text-xs">
          ساعات الحضور معروضة؛ احتساب العبء الزائد ينتظر استكمال توزيع ساعات التدريس المشترك.
        </p>
      )}
    </section>
  );
}
