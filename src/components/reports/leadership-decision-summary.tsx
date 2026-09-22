import {
  aggregateLeadership,
  coveragePercent,
  formatLeadershipAmount,
  type LeadershipCollege,
} from "@/lib/reports/leadership";
import {
  aggregateLeadershipRoomCapacity,
  type LeadershipCapacityCollege,
} from "@/lib/reports/leadership-room-capacity";
import {
  decisionOrder,
  leadershipPriorities,
  type LeadershipDetailTab,
} from "@/lib/reports/leadership-decisions";

const amount = (value: number | null | undefined) => formatLeadershipAmount(value);
const hours = (value: number | null | undefined) => formatLeadershipAmount(value, "ساعة");
const actionClass =
  "rounded-lg border px-3 py-2 text-xs font-semibold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface LeadershipDecisionSummaryProps {
  colleges: LeadershipCollege[];
  uniqueFaculty: number | null;
  capacity: LeadershipCapacityCollege[];
  capacityState: "loading" | "error" | "ready" | "restricted";
  onOpen: (tab: LeadershipDetailTab, collegeId?: string) => void;
}

/** The default screen contains no detailed records, formulas, or hidden mounted report panels. */
export function LeadershipDecisionSummary({
  colleges,
  uniqueFaculty,
  capacity,
  capacityState,
  onOpen,
}: LeadershipDecisionSummaryProps) {
  const published = colleges.filter((college) => !!college.version_id).length;
  const teachingKnown = colleges.filter(
    (college) =>
      college.term_state === "ready" &&
      !!college.groups_count &&
      college.required_hours !== null &&
      college.covered_hours !== null &&
      college.uncovered_hours !== null,
  );
  const uncovered = aggregateLeadership(teachingKnown, "uncovered_hours");
  const availableFaculty = colleges.reduce(
    (sum, college) => sum + (college.availability_counts["متاح"] ?? 0),
    0,
  );
  const incompleteQuota = aggregateLeadership(colleges, "incomplete_faculty");
  // Never mix a pending/error room snapshot with the current overview.
  const capacityRows = capacityState === "ready" ? capacity : [];
  const roomTotals = aggregateLeadershipRoomCapacity(capacityRows);
  const priorities = leadershipPriorities(colleges, capacityRows);
  const ordered = decisionOrder(colleges, priorities);
  const cards = [
    {
      tab: "teaching" as const,
      label: "الجداول",
      value: `${published} من ${colleges.length}`,
      detail: "كليات لديها جدول منشور",
      note: "الجاهزية تتطلب مراجعة الفحص",
      action: "عرض حالة الجداول",
      style: "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20",
    },
    {
      tab: "teaching" as const,
      label: "تغطية التدريس",
      value: hours(uncovered.value),
      detail: "تدريس غير مسند في البيانات المحسوبة",
      note: `المصدر: ${teachingKnown.length} من ${colleges.length} كليات${teachingKnown.length < colleges.length ? " · جزئي" : ""}`,
      action: "مراجعة تغطية التدريس",
      style: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
    },
    {
      tab: "faculty" as const,
      label: "المحاضرون",
      value: amount(uniqueFaculty),
      detail: `${amount(availableFaculty)} متاح بحسب الحالة الوظيفية`,
      note: `${amount(incompleteQuota.value)} نصابًا يحتاج استكمالًا${incompleteQuota.complete ? "" : " · حصر جزئي"}`,
      action: "عرض المحاضرين والأنصبة",
      style: "border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/20",
    },
    {
      tab: "rooms" as const,
      label: "القاعات",
      value:
        capacityState === "ready"
          ? hours(roomTotals.surplusHours)
          : capacityState === "loading"
            ? "جارٍ الحساب…"
            : "غير محسوب",
      detail: "فائض أسبوعي في الكليات ذات الفائض",
      note:
        capacityState === "ready"
          ? `${roomTotals.knownColleges} من ${colleges.length} كليات · العجز ${hours(roomTotals.deficitHours)}`
          : capacityState === "error"
            ? "تعذر تحديث حساب القاعات"
            : capacityState === "restricted"
              ? "راجع بيانات قاعات الكلية"
              : "تُراجع إتاحة القاعات والاحتياج",
      action: "أين يوجد الفائض أو العجز؟",
      style: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
    },
  ];
  return (
    <div className="space-y-4" dir="rtl" data-testid="leadership-decision-summary">
      <section
        aria-label="نظرة الجامعة السريعة"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {cards.map((card) => (
          <article
            key={card.label}
            className={`flex min-w-0 flex-col rounded-xl border p-4 ${card.style}`}
            data-testid="leadership-decision-card"
          >
            <h2 className="text-sm font-semibold">{card.label}</h2>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value}</p>
            <p className="mt-1 text-xs leading-5">{card.detail}</p>
            <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">{card.note}</p>
            <button
              type="button"
              className={`${actionClass} report-no-print mt-auto bg-background/70`}
              onClick={() => onOpen(card.tab)}
            >
              {card.action}
            </button>
          </article>
        ))}
      </section>

      <section
        className="rounded-xl border bg-card"
        aria-labelledby="leadership-priorities-title"
        data-testid="leadership-priorities"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id="leadership-priorities-title" className="text-sm font-bold">
            أولويات المتابعة
          </h2>
          <span className="text-xs text-muted-foreground">
            {priorities.length
              ? `أبرز ${Math.min(3, priorities.length)} من ${priorities.length} كليات تحتاج مراجعة`
              : "لا توجد ملاحظات ضمن المؤشرات المحسوبة"}
          </span>
        </div>
        {priorities.length > 0 ? (
          <ol className="divide-y px-4">
            {priorities.slice(0, 3).map((item, index) => (
              <li key={item.collegeId} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-900"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-semibold">
                    {item.title}{" "}
                    <span className="font-normal text-muted-foreground">· {item.collegeName}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.impact} الجهة المعنية: {item.team}.
                  </p>
                </div>
                <button
                  type="button"
                  className={`${actionClass} report-no-print`}
                  onClick={() => onOpen(item.tab, item.collegeId)}
                  aria-label={`عرض السبب: ${item.collegeName}`}
                >
                  عرض السبب
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            راجع اكتمال البيانات ونتائج الفحص قبل الحكم على الجاهزية.
          </p>
        )}
      </section>

      <section
        className="overflow-hidden rounded-xl border bg-card"
        aria-labelledby="leadership-comparison-title"
        data-testid="leadership-colleges-comparison"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id="leadership-comparison-title" className="text-sm font-bold">
            الكليات في نظرة واحدة{" "}
            <span className="font-normal text-muted-foreground">· {colleges.length}</span>
          </h2>
          <span className="text-xs text-muted-foreground">مرتبة بحسب أولوية المتابعة</span>
        </div>
        <div className="overflow-x-auto">
          <table className="block w-full text-right text-xs sm:table">
            <caption className="sr-only">المقارنة المختصرة للكليات</caption>
            <thead className="hidden bg-muted/40 sm:table-header-group">
              <tr>
                {[
                  "الكلية وأهم ملاحظة",
                  "النشر",
                  "الإسناد التدريسي",
                  "الأنصبة",
                  "ساعات القاعات",
                  "التفاصيل",
                ].map((label) => (
                  <th scope="col" key={label} className="p-3 font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block divide-y sm:table-row-group">
              {ordered.map((college) => {
                const priority = priorities.find((item) => item.collegeId === college.college_id);
                const room = capacityRows.find((item) => item.id === college.college_id);
                const percent = teachingKnown.some((item) => item.college_id === college.college_id)
                  ? coveragePercent(college)
                  : null;
                return (
                  <tr
                    key={college.college_id}
                    className="grid grid-cols-2 gap-x-2 p-2 align-top sm:table-row sm:p-0"
                  >
                    <th scope="row" className="col-span-2 p-2 text-start sm:max-w-64 sm:p-3">
                      <button
                        type="button"
                        className="text-start font-bold text-primary underline decoration-dotted underline-offset-4"
                        onClick={() => onOpen("quality", college.college_id)}
                      >
                        {college.college}
                      </button>
                      <span className="mt-1 block font-normal leading-5 text-muted-foreground">
                        {priority?.title ?? "لا توجد ملاحظة ضمن البيانات المحسوبة"}
                      </span>
                    </th>
                    <td className="p-2 sm:p-3">
                      <span className="mb-1 block text-muted-foreground sm:hidden">النشر</span>
                      <span
                        className={`inline-block rounded-md px-2 py-1 ${college.version_id ? "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}
                      >
                        {college.term_state !== "ready"
                          ? "الفترة ناقصة"
                          : college.version_id
                            ? "منشور"
                            : "غير منشور"}
                      </span>
                    </td>
                    <td className="p-2 tabular-nums sm:p-3">
                      <span className="mb-1 block text-muted-foreground sm:hidden">الإسناد</span>
                      {percent === null ? "غير محسوب" : `${percent}%`}
                      <span className="mt-1 block text-muted-foreground">
                        غير المسند: {hours(college.uncovered_hours)}
                      </span>
                    </td>
                    <td className="p-2 tabular-nums sm:p-3">
                      <span className="mb-1 block text-muted-foreground sm:hidden">الأنصبة</span>
                      زيادة {hours(college.overload)}
                      <span className="mt-1 block">نقص {hours(college.deficit)}</span>
                      {(college.incomplete_faculty ?? 0) > 0 && (
                        <span className="mt-1 block text-amber-800 dark:text-amber-200">
                          بيانات جزئية
                        </span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums sm:p-3">
                      <span className="mb-1 block text-muted-foreground sm:hidden">القاعات</span>
                      {room?.balanceHours === null || room?.balanceHours === undefined ? (
                        "غير محسوب"
                      ) : (
                        <span
                          className={
                            room.balanceHours < 0
                              ? "text-rose-800 dark:text-rose-200"
                              : "text-emerald-800 dark:text-emerald-200"
                          }
                        >
                          {room.balanceHours < 0 ? "عجز" : "فائض"}{" "}
                          {hours(Math.abs(room.balanceHours))}
                        </span>
                      )}
                    </td>
                    <td className="col-span-2 p-2 sm:p-3">
                      <button
                        type="button"
                        className={`${actionClass} report-no-print`}
                        onClick={() => onOpen(priority?.tab ?? "teaching", college.college_id)}
                        aria-label={`تفاصيل ${college.college}`}
                      >
                        التفاصيل
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs leading-5 text-muted-foreground">
          النقص في الأنصبة مستقل عن التدريس غير المسند. فائض القاعات مكافئ زمني؛ تظهر تفاصيل الإتاحة
          والملاءمة عند فتح الكلية.
        </p>
      </section>
    </div>
  );
}
