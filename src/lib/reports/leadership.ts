import { z } from "zod";

const amount = z.number().finite().nonnegative().nullable();
export const leadershipCollegeSchema = z.object({
  college_id: z.string().uuid(),
  college: z.string(),
  term_id: z.string().uuid().nullable(),
  term: z.string().nullable(),
  term_state: z.enum(["ready", "missing", "ambiguous"]),
  year_inferred: z.boolean().nullable(),
  departments: amount,
  programs: amount,
  faculty_count: amount,
  incomplete_faculty: amount,
  net_quota: amount,
  faculty_assigned_hours: amount,
  overload: amount,
  deficit: amount,
  groups_count: amount,
  covered_groups: amount,
  required_hours: amount,
  covered_hours: amount,
  assigned_hours: amount,
  uncovered_hours: amount,
  pending_groups: amount,
  pending_group_hours: amount,
  overallocated_groups: amount,
  version_id: z.string().uuid().nullable(),
  version: z.string().nullable(),
  version_updated_at: z.string().nullable(),
  sessions_count: amount,
  teaching_hours: amount,
  theory_hours: amount,
  practical_hours: amount,
  other_hours: amount,
  room_count: amount,
  halls: amount,
  labs: amount,
  seats: amount,
  used_rooms: amount,
});
export const leadershipOverviewSchema = z.object({
  year: z.string().nullable(),
  term_type: z.string().nullable(),
  generated_at: z.string(),
  periods: z.array(z.object({ year: z.string(), type: z.string() })),
  colleges: z.array(leadershipCollegeSchema),
});
export type LeadershipCollege = z.infer<typeof leadershipCollegeSchema>;
export const termTypeLabel = (value: string) =>
  (
    ({ first: "الفصل الأول", second: "الفصل الثاني", summer: "الفصل الصيفي" }) as Record<
      string,
      string
    >
  )[value] ?? value;
export function sumLeadership(rows: LeadershipCollege[], key: keyof LeadershipCollege): number {
  return (
    Math.round(
      rows.reduce(
        (total, row) => total + (typeof row[key] === "number" ? Number(row[key]) : 0),
        0,
      ) * 100,
    ) / 100
  );
}
export function coveragePercent(row: LeadershipCollege): number | null {
  if (row.required_hours === null || row.covered_hours === null || row.required_hours <= 0)
    return null;
  return Math.round((1000 * row.covered_hours) / row.required_hours) / 10;
}
export function leadershipNotice(row: LeadershipCollege): string {
  if (row.term_state === "missing") return "لم يُحدد فصل مطابق؛ المؤشرات الأكاديمية غير محسوبة";
  if (row.term_state === "ambiguous") return "أكثر من فصل مطابق؛ يلزم تحديد الفصل المعتمد";
  const notes: string[] = [];
  if (!row.version_id) notes.push("لا يوجد جدول منشور لهذا الفصل");
  if (row.incomplete_faculty) notes.push(`${row.incomplete_faculty} نصابًا غير مكتمل`);
  if (row.pending_groups) notes.push(`${row.pending_groups} مجموعة بانتظار توزيع التدريس المشترك`);
  if (row.overallocated_groups)
    notes.push(`${row.overallocated_groups} مجموعة بإسناد يتجاوز المطلوب`);
  if (row.year_inferred) notes.push("السنة مستمدة من اسم الفصل؛ يُرجى استكمال تعريفه");
  return notes.join(" · ") || "البيانات متاحة";
}

export const LEADERSHIP_WORKLOAD_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "faculty_count", label: "أعضاء هيئة التدريس" },
  { key: "net_quota", label: "النصاب المتاح المعتمد" },
  { key: "faculty_assigned_hours", label: "المسند لأعضاء الكلية" },
  { key: "overload", label: "الساعات الزائدة" },
  { key: "deficit", label: "نقص النصاب" },
  { key: "incomplete_faculty", label: "نصاب غير مكتمل" },
];
export const LEADERSHIP_ASSIGNMENT_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "groups_count", label: "مجموعات التدريس" },
  { key: "required_hours", label: "الساعات المطلوبة" },
  { key: "covered_hours", label: "الساعات المغطاة" },
  { key: "uncovered_hours", label: "عجز تغطية الإسناد" },
  { key: "pending_group_hours", label: "بانتظار التوزيع" },
  { key: "coverage", label: "تغطية الإسناد" },
];
export const LEADERSHIP_TEACHING_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "theory_hours", label: "نظري" },
  { key: "practical_hours", label: "عملي ومعامل" },
  { key: "other_hours", label: "مكونات أخرى" },
  { key: "teaching_hours", label: "إجمالي الساعات" },
  { key: "sessions_count", label: "المحاضرات" },
];
export const LEADERSHIP_ROOM_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "room_count", label: "إجمالي الموارد" },
  { key: "halls", label: "قاعات" },
  { key: "labs", label: "معامل" },
  { key: "seats", label: "المقاعد المتاحة" },
  { key: "used_rooms", label: "موارد مستخدمة في المنشور" },
];
