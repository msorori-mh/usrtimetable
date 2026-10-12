import { z } from "zod";

export const COVERAGE_LABELS = {
  internal: "مثبّتون في الكلية",
  other_college: "من كليات أخرى",
  contractual: "تعاقد خارجي",
  unknown: "تصنيف غير محسوم",
} as const;
export type CoverageCategory = keyof typeof COVERAGE_LABELS;
const category = z.enum(["internal", "other_college", "contractual", "unknown"]);
const amount = z.number().finite().nonnegative();
const fact = z.object({
  identity_id: z.string().min(1),
  instructor: z.string(),
  university_number: z.string().nullable(),
  home_college_name: z.string().nullable(),
  category,
  program_id: z.string().nullable(),
  program: z.string().nullable(),
  department_id: z.string().nullable(),
  department: z.string().nullable(),
  study_system: z.enum(["regular", "parallel", "unknown"]),
  hours: amount,
  project: amount,
  allocation_pending: z.boolean(),
});
export type CoverageFact = z.infer<typeof fact>;
export const SYSTEM_LABELS = {
  all: "العام والموازي",
  regular: "العام",
  parallel: "الموازي",
  unknown: "نظام غير محدد",
};
export function parseCoverage(value: unknown, collegeId: string, termId: string): CoverageFact[] {
  const parsed = z
    .object({ college_id: z.literal(collegeId), term_id: z.literal(termId), rows: z.array(fact) })
    .parse(value);
  const keys = parsed.rows.map((r) =>
    JSON.stringify([r.identity_id, r.program_id, r.study_system]),
  );
  if (new Set(keys).size !== keys.length) throw new Error("تكرار في بيانات التغطية");
  return parsed.rows;
}
export function parseFacultyCategories(value: unknown, collegeId: string) {
  const parsed = z
    .object({
      college_id: z.literal(collegeId),
      rows: z.array(z.object({ identity_id: z.string(), category })),
    })
    .parse(value);
  const result = new Map<string, CoverageCategory>();
  for (const row of parsed.rows) {
    if (result.has(row.identity_id)) throw new Error("تكرار في تصنيف المحاضرين");
    result.set(row.identity_id, row.category);
  }
  return result;
}
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export function summarizeCoverage(rows: CoverageFact[]) {
  const sums = {
    internal: 0,
    other_college: 0,
    contractual: 0,
    unknown: 0,
    pending: 0,
    project: 0,
    total: 0,
    pendingMembers: 0,
  };
  const pending = new Set<string>();
  for (const r of rows) {
    sums.project += r.project;
    if (r.allocation_pending) {
      sums.pending += r.hours;
      pending.add(r.identity_id);
      continue;
    }
    sums[r.category] += r.hours;
    sums.total += r.hours;
  }
  for (const key of Object.keys(sums) as Array<keyof typeof sums>) sums[key] = round(sums[key]);
  sums.pendingMembers = pending.size;
  return sums;
}
export const COVERAGE_HEADERS = [
  { key: "instructor", label: "المحاضر" },
  { key: "university_number", label: "الرقم الجامعي" },
  { key: "category", label: "مصدر التغطية" },
  { key: "home_college", label: "الكلية الأصلية" },
  { key: "department", label: "القسم المستفيد" },
  { key: "program", label: "البرنامج المستفيد" },
  { key: "system", label: "النظام" },
  { key: "hours", label: "الساعات الأسبوعية المؤكدة" },
  { key: "project", label: "إشراف المشاريع منفصلاً" },
  { key: "status", label: "حالة البيانات" },
];
export function coverageDisplayRows(rows: CoverageFact[]) {
  return rows.map((r) => ({
    instructor: r.instructor,
    university_number: r.university_number ?? "—",
    category: COVERAGE_LABELS[r.category],
    home_college: r.home_college_name ?? "غير محدد",
    department: r.department ?? "غير محدد",
    program: r.program ?? "غير محدد",
    system: SYSTEM_LABELS[r.study_system],
    hours: r.allocation_pending ? null : r.hours,
    project: r.project,
    status: r.allocation_pending
      ? "بانتظار توزيع الساعات"
      : r.category === "unknown"
        ? "بانتظار اعتماد التصنيف"
        : "مكتمل",
  }));
}
