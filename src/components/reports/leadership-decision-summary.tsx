import { ArrowLeft, BookOpenCheck, CalendarDays, DoorOpen, Users } from "lucide-react";
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
const actionClass = "leadership-action";

const roomReuseOpportunity = (room: LeadershipCapacityCollege | undefined) => {
  if (
    room?.balanceHours === null ||
    room?.balanceHours === undefined ||
    room.surplusHours === null ||
    room.surplusHours === undefined ||
    !room.equivalents
  )
    return "غير محسوب";
  if (room.surplusHours <= 0) return "لا توجد سعة فائضة";

  const rooms = room.equivalents.fullRooms;
  const remainingDays = Math.floor((room.equivalents.hoursAfterRooms + 1e-9) / 6);
  const remainingHours =
    Math.round((room.equivalents.hoursAfterRooms - remainingDays * 6) * 100) / 100;
  const opportunities: string[] = [];

  if (rooms === 1) opportunities.push("قاعة أسبوعية كاملة");
  else if (rooms === 2) opportunities.push("قاعتين أسبوعيتين كاملتين");
  else if (rooms > 2) opportunities.push(`${rooms} قاعات أسبوعية كاملة`);

  if (remainingDays === 1) opportunities.push("يوم قاعة");
  else if (remainingDays === 2) opportunities.push("يومين قاعة");
  else if (remainingDays > 2) opportunities.push(`${remainingDays} أيام قاعة`);

  if (remainingHours === 1) opportunities.push("ساعة واحدة");
  else if (remainingHours > 0) opportunities.push(`${amount(remainingHours)} ساعات`);

  return `يعادل ${opportunities.join(" + ")}`;
};

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
      tone: "schedules",
      icon: CalendarDays,
    },
    {
      tab: "teaching" as const,
      label: "تغطية التدريس",
      value: hours(uncovered.value),
      detail: "تدريس غير مسند في البيانات المحسوبة",
      note: `المصدر: ${teachingKnown.length} من ${colleges.length} كليات${teachingKnown.length < colleges.length ? " · جزئي" : ""}`,
      action: "مراجعة تغطية التدريس",
      tone: "teaching",
      icon: BookOpenCheck,
    },
    {
      tab: "faculty" as const,
      label: "المحاضرون",
      value: amount(uniqueFaculty),
      detail: `${amount(availableFaculty)} متاح بحسب الحالة الوظيفية`,
      note: `${amount(incompleteQuota.value)} نصابًا يحتاج استكمالًا${incompleteQuota.complete ? "" : " · حصر جزئي"}`,
      action: "عرض المحاضرين والأنصبة",
      tone: "faculty",
      icon: Users,
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
      tone: "rooms",
      icon: DoorOpen,
    },
  ];
  return (
    <div className="leadership-overview" dir="rtl" data-testid="leadership-decision-summary">
      <section aria-label="نظرة الجامعة السريعة" className="leadership-cards">
        {cards.map((card) => (
          <article
            key={card.label}
            className={`leadership-card leadership-card--${card.tone}`}
            data-testid="leadership-decision-card"
          >
            <div className="leadership-card-heading">
              <h2>{card.label}</h2>
              <card.icon aria-hidden="true" className="leadership-card-icon" />
            </div>
            <p className="leadership-card-value">{card.value}</p>
            <p className="leadership-card-detail">{card.detail}</p>
            <p className="leadership-card-note">{card.note}</p>
            <button
              type="button"
              className="leadership-card-action report-no-print"
              onClick={() => onOpen(card.tab)}
            >
              {card.action}
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
          </article>
        ))}
      </section>

      <section
        className="leadership-section leadership-priorities"
        aria-labelledby="leadership-priorities-title"
        data-testid="leadership-priorities"
      >
        <div className="leadership-section-heading">
          <h2 id="leadership-priorities-title">أولويات المتابعة</h2>
          <span className="leadership-section-note">
            {priorities.length
              ? `أبرز ${Math.min(3, priorities.length)} من ${priorities.length} كليات تحتاج مراجعة`
              : "لا توجد ملاحظات ضمن المؤشرات المحسوبة"}
          </span>
        </div>
        {priorities.length > 0 ? (
          <ol className="leadership-priority-list">
            {priorities.slice(0, 3).map((item, index) => (
              <li key={item.collegeId} className="leadership-priority">
                <div className="leadership-priority-title">
                  <span aria-hidden className="leadership-priority-number">
                    {index + 1}
                  </span>
                  <h3>{item.title}</h3>
                </div>
                <p className="leadership-priority-college">{item.collegeName}</p>
                <p className="leadership-priority-impact">{item.impact}</p>
                <p className="leadership-priority-team">الجهة المعنية: {item.team}.</p>
                <button
                  type="button"
                  className={`${actionClass} leadership-priority-action report-no-print`}
                  onClick={() => onOpen(item.tab, item.collegeId)}
                  aria-label={`عرض السبب: ${item.collegeName}`}
                >
                  عرض السبب
                  <ArrowLeft aria-hidden="true" size={16} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="leadership-empty-note">
            راجع اكتمال البيانات ونتائج الفحص قبل الحكم على الجاهزية.
          </p>
        )}
      </section>

      <section
        className="leadership-section leadership-comparison"
        aria-labelledby="leadership-comparison-title"
        data-testid="leadership-colleges-comparison"
      >
        <div className="leadership-section-heading">
          <h2 id="leadership-comparison-title">
            الكليات في نظرة واحدة <span className="leadership-count">· {colleges.length}</span>
          </h2>
          <span className="leadership-section-note">مرتبة بحسب أولوية المتابعة</span>
        </div>
        <div className="overflow-x-auto">
          <table className="leadership-table">
            <caption className="sr-only">المقارنة المختصرة للكليات</caption>
            <thead>
              <tr>
                {[
                  "الكلية وأهم ملاحظة",
                  "النشر",
                  "الإسناد التدريسي",
                  "الأنصبة",
                  "ساعات القاعات",
                  "فرصة إعادة الاستخدام",
                  "التفاصيل",
                ].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((college) => {
                const priority = priorities.find((item) => item.collegeId === college.college_id);
                const room = capacityRows.find((item) => item.id === college.college_id);
                const percent = teachingKnown.some((item) => item.college_id === college.college_id)
                  ? coveragePercent(college)
                  : null;
                const reuseOpportunity = roomReuseOpportunity(room);
                return (
                  <tr key={college.college_id} className="leadership-college-row">
                    <th scope="row" className="leadership-college-name">
                      <button
                        type="button"
                        className="leadership-college-link"
                        onClick={() => onOpen("quality", college.college_id)}
                      >
                        {college.college}
                      </button>
                      <span className="leadership-cell-note">
                        {priority?.title ?? "لا توجد ملاحظة ضمن البيانات المحسوبة"}
                      </span>
                    </th>
                    <td>
                      <span className="leadership-mobile-label">النشر</span>
                      <span
                        className={`leadership-status leadership-status--${college.term_state !== "ready" ? "unknown" : college.version_id ? "published" : "pending"}`}
                      >
                        {college.term_state !== "ready"
                          ? "الفترة ناقصة"
                          : college.version_id
                            ? "منشور"
                            : "غير منشور"}
                      </span>
                    </td>
                    <td>
                      <span className="leadership-mobile-label">الإسناد</span>
                      <strong>{percent === null ? "غير محسوب" : `${percent}%`}</strong>
                      {percent !== null && (
                        <span className="leadership-coverage-track" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.min(100, Math.max(0, percent))}%`,
                            }}
                          />
                        </span>
                      )}
                      <span className="leadership-cell-note">
                        غير المسند: {hours(college.uncovered_hours)}
                      </span>
                    </td>
                    <td>
                      <span className="leadership-mobile-label">الأنصبة</span>
                      زيادة {hours(college.overload)}
                      <span className="mt-1 block">نقص {hours(college.deficit)}</span>
                      {(college.incomplete_faculty ?? 0) > 0 && (
                        <span className="leadership-quota-note">بيانات جزئية</span>
                      )}
                    </td>
                    <td>
                      <span className="leadership-mobile-label">القاعات</span>
                      {room?.balanceHours === null || room?.balanceHours === undefined ? (
                        "غير محسوب"
                      ) : (
                        <span
                          className={`leadership-status leadership-status--${room.balanceHours < 0 ? "deficit" : "surplus"}`}
                        >
                          {room.balanceHours < 0 ? "عجز" : "فائض"}{" "}
                          {hours(Math.abs(room.balanceHours))}
                        </span>
                      )}
                    </td>
                    <td className="leadership-reuse-cell">
                      <span className="leadership-mobile-label">فرصة إعادة الاستخدام</span>
                      <strong>{reuseOpportunity}</strong>
                      {room?.surplusHours !== null &&
                        room?.surplusHours !== undefined &&
                        room.surplusHours > 0 && (
                          <span className="leadership-cell-note">
                            مكافئ زمني قابل لإعادة التوزيع
                          </span>
                        )}
                    </td>
                    <td className="leadership-college-action">
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
        <p className="leadership-footnote">
          النقص في الأنصبة مستقل عن التدريس غير المسند. فرص إعادة الاستخدام مكافئات زمنية؛ لا تعني
          توافر قاعة بعينها قبل مراجعة توزيع الأيام والفترات وملاءمة القاعة.
        </p>
      </section>
    </div>
  );
}
