import {
  aggregateLeadershipRoomCapacity,
  roomHourEquivalents,
  type LeadershipCapacityCollege,
} from "@/lib/reports/leadership-room-capacity";

const number = (n: number | null) =>
  n === null ? "غير محسوب" : n.toLocaleString("ar", { maximumFractionDigits: 2 });
const hours = (n: number | null) => (n === null ? "غير محسوب" : `${number(n)} ساعة`);
export function capacityEquivalentText(
  value: ReturnType<typeof roomHourEquivalents>,
  unit: "days" | "rooms",
) {
  if (!value) return "غير محسوب";
  const count = unit === "days" ? value.fullDays : value.fullRooms;
  const remainder = unit === "days" ? value.hoursAfterDays : value.hoursAfterRooms;
  return `${number(count)} ${unit === "days" ? "يوم" : "قاعة"}${remainder ? ` و${hours(remainder)}` : ""}`;
}

function CapacityStat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "surplus" | "deficit";
}) {
  return (
    <div
      className={`min-w-0 rounded-lg border p-3 ${
        tone === "surplus"
          ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          : tone === "deficit"
            ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"
            : "bg-muted/30"
      }`}
    >
      <dt className="text-xs leading-5">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

export function LeadershipRoomCapacitySummary({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: LeadershipCapacityCollege[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const totals = aggregateLeadershipRoomCapacity(rows);
  return (
    <section
      className="rounded-xl border bg-card text-card-foreground"
      aria-labelledby="room-capacity-title"
      data-testid="leadership-room-capacity"
      dir="rtl"
    >
      <div className="border-b p-4">
        <h2 id="room-capacity-title" className="text-base font-bold">
          ساعات القاعات والفائض عن الاحتياج
        </h2>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">
          مقارنة أسبوعية للفصل المختار تشمل القاعات والمعامل. كل 6 ساعات تعادل يوم قاعة، وكل 36 ساعة
          تعادل قاعة لأسبوع.
        </p>
      </div>
      {loading ? (
        <p className="p-4 text-sm" role="status">
          جارٍ حساب ساعات القاعات لكل كلية…
        </p>
      ) : error ? (
        <div className="space-y-2 p-4 text-sm" role="alert">
          <p>تعذر تحميل بيانات القاعات. لم تُعرض نتائج قديمة أو أرقام تقديرية.</p>
          <button type="button" className="rounded border px-3 py-1.5" onClick={onRetry}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">ملخص الجامعة</h3>
            <span className="text-xs text-muted-foreground">
              {totals.complete
                ? "جميع الكليات مكتملة الحساب"
                : `ملخص جزئي: ${number(totals.knownColleges)} من ${number(totals.totalColleges)} كليات مكتملة الحساب`}
            </span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CapacityStat label="ساعات القاعات المتاحة" value={hours(totals.availableHours)} />
            <CapacityStat
              label="إجمالي ساعات التدريس المطلوبة"
              value={hours(totals.requiredHours)}
            />
            <CapacityStat
              label="الفائض في الكليات ذات الفائض"
              value={hours(totals.surplusHours)}
              tone="surplus"
            />
            <CapacityStat
              label="العجز في الكليات ذات العجز"
              value={hours(totals.deficitHours)}
              tone="deficit"
            />
          </dl>
          <p
            className="rounded-lg bg-muted/40 p-3 text-sm leading-7"
            data-testid="university-room-equivalents"
          >
            مكافئ الفائض: <b>{capacityEquivalentText(totals.equivalents, "rooms")}</b>، أو{" "}
            <b>{capacityEquivalentText(totals.equivalents, "days")}</b>.
            {totals.roomsByCollege !== null && (
              <>
                {" "}
                مجموع مكافئات القاعات الكاملة المحسوبة داخل كل كلية على حدة:{" "}
                <b>{number(totals.roomsByCollege)}</b>.
              </>
            )}
          </p>
          {!totals.complete && (
            <p className="text-xs leading-6 text-amber-800 dark:text-amber-200">
              إجماليات الملخص تخص الكليات مكتملة المقارنة فقط. تظهر بقية الكليات أدناه مع سبب عدم
              الاحتساب.
            </p>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {rows.map((college) => (
              <article
                key={college.id}
                className="min-w-0 rounded-lg border p-4"
                data-testid={`room-capacity-${college.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-bold">{college.name}</h3>
                  <span className="text-xs text-muted-foreground">
                    {number(college.rooms.length)} قاعة ومعمل
                  </span>
                </div>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <CapacityStat label="المتاح أسبوعيًا" value={hours(college.availableHours)} />
                  <CapacityStat label="التدريس المطلوب" value={hours(college.requiredHours)} />
                  <CapacityStat
                    label={
                      college.balanceHours !== null && college.balanceHours < 0 ? "العجز" : "الفائض"
                    }
                    value={hours(
                      college.balanceHours === null ? null : Math.abs(college.balanceHours),
                    )}
                    tone={
                      college.balanceHours === null
                        ? "normal"
                        : college.balanceHours < 0
                          ? "deficit"
                          : "surplus"
                    }
                  />
                </dl>
                {college.equivalents && (
                  <p className="mt-3 text-sm leading-7">
                    الفائض يعادل <b>{capacityEquivalentText(college.equivalents, "rooms")}</b>، أو{" "}
                    <b>{capacityEquivalentText(college.equivalents, "days")}</b>.
                  </p>
                )}
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  قاعات خالية تمامًا في النسخ المنشورة المختارة:{" "}
                  <b>{number(college.emptyPublishedRooms)}</b>.
                </p>
                {college.issues.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs leading-6 text-amber-800 dark:text-amber-200">
                    {college.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
                <details className="mt-3 border-t pt-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    تفاصيل ساعات كل قاعة
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[580px] text-right text-xs">
                      <caption className="sr-only">ساعات قاعات {college.name}</caption>
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="p-2">القاعة والنوع</th>
                          <th className="p-2">المتاح أسبوعيًا</th>
                          <th className="p-2">المشغول</th>
                          <th className="p-2">غير المستخدم</th>
                          <th className="p-2">ما يعادله من أيام</th>
                        </tr>
                      </thead>
                      <tbody>
                        {college.rooms.map((room) => (
                          <tr key={room.id} className="border-b align-top">
                            <th scope="row" className="p-2 font-medium">
                              <span>{room.name}</span>
                              <span className="block font-normal text-muted-foreground">
                                {room.code} · {room.type} · {number(room.seats)} مقعد
                              </span>
                              {room.issue && (
                                <span className="block font-normal text-amber-800 dark:text-amber-200">
                                  {room.issue}
                                </span>
                              )}
                            </th>
                            <td className="p-2 tabular-nums">{hours(room.availableHours)}</td>
                            <td className="p-2 tabular-nums">{hours(room.occupiedHours)}</td>
                            <td className="p-2 tabular-nums">{hours(room.idleHours)}</td>
                            <td className="p-2">
                              {capacityEquivalentText(roomHourEquivalents(room.idleHours), "days")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </article>
            ))}
          </div>
          <p className="border-t pt-3 text-xs leading-6 text-muted-foreground">
            المتاح يتبع أيام وساعات تشغيل الكلية وإتاحة كل قاعة، دون تكرار الفترات المتداخلة. الفائض
            = المتاح − إجمالي التدريس المطلوب، ويُعرض العجز منفصلًا. مكافئ القاعة لا يعني وجود قاعة
            بعينها يمكن الاستغناء عنها؛ يلزم مراعاة نوع القاعات وسعتها وتوزيع المحاضرات. «غير
            المستخدم» يصف النسخ المنشورة المختارة وقد يلزم لاستكمال التدريس غير المجدول.
          </p>
        </div>
      )}
    </section>
  );
}
