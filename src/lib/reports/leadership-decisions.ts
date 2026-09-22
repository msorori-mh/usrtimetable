import type { LeadershipCollege } from "./leadership";
import type { LeadershipCapacityCollege } from "./leadership-room-capacity";

export type LeadershipDetailTab = "teaching" | "faculty" | "rooms" | "quality";
export interface LeadershipPriority {
  collegeId: string;
  collegeName: string;
  title: string;
  impact: string;
  team: string;
  tab: LeadershipDetailTab;
  severity: number;
}

/** Explicit review order, not an inferred readiness score or an automatic decision. */
export function leadershipPriorities(
  colleges: LeadershipCollege[],
  capacity: LeadershipCapacityCollege[],
): LeadershipPriority[] {
  return colleges
    .flatMap((college): LeadershipPriority[] => {
      const room = capacity.find((item) => item.id === college.college_id);
      const candidates: Omit<LeadershipPriority, "collegeId" | "collegeName">[] = [];
      const add = (
        severity: number,
        tab: LeadershipDetailTab,
        title: string,
        impact: string,
        team: string,
      ) => candidates.push({ severity, tab, title, impact, team });
      if (college.term_state !== "ready") {
        add(
          85,
          "quality",
          "تحديد الفترة الأكاديمية",
          "يتعذر الحكم على مؤشرات الكلية قبل استكمال الفترة.",
          "إدارة الكلية والشؤون الأكاديمية",
        );
      } else {
        if ((college.uncovered_hours ?? 0) > 0)
          add(
            100,
            "teaching",
            `${college.uncovered_hours} ساعة تدريس غير مسندة`,
            "تحتاج المقررات إلى استكمال الإسناد التدريسي.",
            "عمادة الكلية والشؤون الأكاديمية",
          );
        if ((college.pending_groups ?? 0) > 0 || (college.overallocated_groups ?? 0) > 0)
          add(
            95,
            "teaching",
            "مراجعة توزيع الإسناد",
            "توجد مجموعات بانتظار التوزيع أو بإسناد يتجاوز المطلوب.",
            "الشؤون الأكاديمية",
          );
        if (!college.version_id)
          add(
            80,
            "teaching",
            "لا يوجد جدول منشور",
            "تحتاج حالة النشر إلى متابعة لهذا الفصل.",
            "عمادة الكلية ولجنة الجدولة",
          );
        if ((college.incomplete_faculty ?? 0) > 0)
          add(
            75,
            "faculty",
            `${college.incomplete_faculty} نصابًا غير مكتمل`,
            "قد تتغير نتائج النقص والزيادة بعد استكمال البيانات.",
            "إدارة الكلية وشؤون أعضاء هيئة التدريس",
          );
        if (
          !college.groups_count ||
          college.required_hours === null ||
          college.covered_hours === null
        )
          add(
            70,
            "quality",
            "استكمال بيانات التدريس",
            "لا تكفي البيانات الحالية لتأكيد تغطية التدريس.",
            "الشؤون الأكاديمية",
          );
        if (college.year_inferred)
          add(
            60,
            "quality",
            "مراجعة تعريف السنة الأكاديمية",
            "السنة مستمدة من اسم الفصل وتحتاج تثبيتًا.",
            "إدارة الكلية",
          );
        if ((college.overload ?? 0) > 0)
          add(
            55,
            "faculty",
            `${college.overload} ساعة زائدة`,
            "راجع توزيع الأعباء والتخصصات قبل اتخاذ قرار.",
            "عمادة الكلية وشؤون أعضاء هيئة التدريس",
          );
        else if ((college.deficit ?? 0) > 0)
          add(
            50,
            "faculty",
            `${college.deficit} ساعة نقص في الأنصبة`,
            "راجع الأنصبة والإسناد وتخصصات المحاضرين.",
            "عمادة الكلية وشؤون أعضاء هيئة التدريس",
          );
      }
      if (room?.balanceHours !== null && room?.balanceHours !== undefined && room.balanceHours < 0)
        add(
          90,
          "rooms",
          `${Math.abs(room.balanceHours)} ساعة عجز في القاعات`,
          "راجع الإتاحة والاحتياج ونوع القاعات قبل توفير موارد إضافية.",
          "الأمانة العامة وإدارة الكلية",
        );
      if (room && room.balanceHours === null && college.term_state === "ready")
        add(
          65,
          "rooms",
          "استكمال حساب إتاحة القاعات",
          "يتعذر تأكيد الفائض أو العجز حتى استكمال البيانات.",
          "إدارة الكلية والأمانة العامة",
        );
      const top = candidates.sort((a, b) => b.severity - a.severity)[0];
      return top ? [{ ...top, collegeId: college.college_id, collegeName: college.college }] : [];
    })
    .sort((a, b) => b.severity - a.severity || a.collegeName.localeCompare(b.collegeName, "ar"));
}

export function decisionOrder(colleges: LeadershipCollege[], priorities: LeadershipPriority[]) {
  const rank = new Map(priorities.map((item, index) => [item.collegeId, index]));
  return [...colleges].sort(
    (a, b) =>
      (rank.get(a.college_id) ?? Infinity) - (rank.get(b.college_id) ?? Infinity) ||
      a.college.localeCompare(b.college, "ar"),
  );
}

/** Scope includes role/college assignment changes for the same signed-in account. */
export function leadershipViewerKey(me: {
  id: string;
  roles: readonly string[];
  collegeIds: readonly string[];
}) {
  return JSON.stringify([me.id, [...me.roles].sort(), [...me.collegeIds].sort()]);
}

export const LEADERSHIP_QUERY_POLICY = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;
