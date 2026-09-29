import type { RoomsReportSummaryRow } from "@/lib/print-center/rooms-report";
import type { PrintSessionLike } from "@/lib/print-center/types";

/** Descriptive opportunities, never a claim that a timetable move is feasible. */
export function roomsExecutiveSummary(rows: RoomsReportSummaryRow[], sessions: PrintSessionLike[]) {
  const measurable = rows.filter((row) => row.available_hours > 0);
  const missingAvailability = rows.length - measurable.length;
  const complete = rows.length > 0 && missingAvailability === 0;
  const used = rows.reduce((sum, row) => sum + row.used_hours, 0);
  const scheduled = rows.reduce((sum, row) => sum + (row.scheduled_hours ?? row.used_hours), 0);
  const outside = rows.reduce((sum, row) => sum + (row.outside_hours ?? 0), 0);
  const overlaps = rows.reduce((sum, row) => sum + (row.overlap_hours ?? 0), 0);
  const available = measurable.reduce((sum, row) => sum + row.available_hours, 0);
  const free = measurable.reduce((sum, row) => sum + (row.free_hours ?? 0), 0);
  const utilization = complete ? Math.round((used / available) * 100) : null;
  const opportunities: string[] = [];
  if (outside > 0)
    opportunities.push(
      `توجد ${outside} ساعة مجدولة خارج الإتاحة المعتمدة. راجع أيام وساعات فتح الموارد أو أعد تسكين هذه المحاضرات.`,
    );
  if (overlaps > 0)
    opportunities.push(
      `توجد ${overlaps} ساعة تداخل في حجوزات المورد نفسه. يلزم حل التعارض قبل اعتماد التقرير.`,
    );
  for (const category of ["hall", "lab"] as const) {
    const ranked = measurable
      .filter((row) => row.room_category === category)
      .sort((a, b) => b.utilization_percent - a.utilization_percent);
    const high = ranked[0],
      low = ranked.at(-1);
    if (
      high &&
      low &&
      high.room_id !== low.room_id &&
      high.utilization_percent - low.utilization_percent >= 20
    ) {
      opportunities.push(
        `تفاوت في توزيع الاستخدام: ${high.room_name} عند ${high.utilization} مقابل ${low.room_name} عند ${low.utilization}. يمكن دراسة موازنة التوزيع بين الموارد المتشابهة.`,
      );
    }
  }
  const capacityCandidates = measurable.filter((row) => {
    const capacity = Number(row.capacity);
    const assigned = sessions.filter((session) => session.room_id === row.room_id);
    if (!(capacity > 0) || row.utilization_percent < 80 || !assigned.length) return false;
    if (
      !assigned.every(
        (s) =>
          typeof s.expected_students === "number" &&
          Number.isFinite(s.expected_students) &&
          s.expected_students >= 0,
      )
    )
      return false;
    const average = assigned.reduce((sum, s) => sum + s.expected_students!, 0) / assigned.length;
    return average / capacity < 0.6;
  });
  for (const row of capacityCandidates.slice(0, 2)) {
    const assigned = sessions.filter((s) => s.room_id === row.room_id);
    const fill = Math.round(
      (100 * assigned.reduce((sum, s) => sum + s.expected_students!, 0)) /
        assigned.length /
        Number(row.capacity),
    );
    opportunities.push(
      `فرصة لمواءمة السعة: ${row.room_name} مستخدمة ${row.utilization} من وقتها، بينما متوسط عدد الطلاب المسجل يعادل ${fill}% من مقاعدها. راجع ملاءمة القاعة لحجم المجموعات.`,
    );
  }
  const overview = !rows.length
    ? "لا توجد موارد ضمن نطاق التقرير."
    : !complete
      ? `تحتوي نسخة الكلية على ${scheduled} ساعة مجدولة، منها ${used} ساعة مثبتة داخل الإتاحة. لا يمكن الحكم على فعالية الاستخدام قبل استكمال أو مراجعة إتاحة ${missingAvailability} من أصل ${rows.length} موردًا.`
      : `تحتوي نسخة الكلية على ${scheduled} ساعة مجدولة. داخل الإتاحة المعتمدة، شُغل ${used} من أصل ${available} ساعة (${utilization}%) وبقي ${free} ساعة غير مشغولة${outside > 0 ? `، مع ${outside} ساعة مجدولة خارج الإتاحة` : ""}. ${utilization! >= 90 ? "الضغط العام مرتفع؛ الأولوية لفحص توزيع الحمل وفترات الذروة." : "توجد مساحة لمراجعة توزيع المحاضرات والاستفادة من الأوقات الأقل إشغالًا."}`;
  return {
    complete,
    missingAvailability,
    utilization,
    overview,
    opportunities: opportunities.slice(0, 3),
  };
}
