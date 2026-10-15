export type SystemHoursKind = "overload_system" | "contractual";
export type SystemHoursFilter = "all" | "regular" | "parallel";
export interface SystemHoursFact {
  identity_id: string;
  instructor: string;
  university_number: string;
  rank: string | null;
  quota: number | null;
  regular: number;
  parallel: number;
  unknown: number;
  project: number;
  allocation_pending: boolean;
  classification_pending: boolean;
}
export type SystemHoursRow = Record<string, string | number | null>;
export const ALL_SYSTEM_HOURS_RANKS = "__all_ranks__";
export const systemHoursRankLabel = (rank: unknown): string =>
  typeof rank === "string" && rank.trim() ? rank.trim().replace(/\s+/g, " ") : "غير محددة";
const realHours = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Reject partial/mis-scoped responses instead of exporting believable zeros. */
export function parseSystemHours(
  value: unknown,
  scope: { collegeId: string; termId: string; kind: SystemHoursKind },
): SystemHoursFact[] {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    data.college_id !== scope.collegeId ||
    data.term_id !== scope.termId ||
    data.kind !== scope.kind ||
    !Array.isArray(data.rows)
  )
    throw new Error("تعذر قراءة تقرير الساعات ضمن النطاق المختار");
  const ids = new Set<string>();
  for (const raw of data.rows) {
    const r = raw as SystemHoursFact | null;
    if (
      !r ||
      typeof r.identity_id !== "string" ||
      !r.identity_id ||
      ids.has(r.identity_id) ||
      typeof r.instructor !== "string" ||
      typeof r.university_number !== "string" ||
      !(r.rank === null || typeof r.rank === "string") ||
      !(r.quota === null || realHours(r.quota)) ||
      ![r.regular, r.parallel, r.unknown, r.project].every(realHours) ||
      typeof r.allocation_pending !== "boolean" ||
      typeof r.classification_pending !== "boolean"
    )
      throw new Error("بيانات الساعات غير مكتملة؛ لا يمكن اعتماد التقرير");
    ids.add(r.identity_id);
  }
  return data.rows as SystemHoursFact[];
}

/** Consume the single net quota in regular first, then parallel. Never subtract twice. */
export function buildSystemHoursRows(
  facts: SystemHoursFact[],
  kind: SystemHoursKind,
  system: SystemHoursFilter,
): SystemHoursRow[] {
  return facts.flatMap((f) => {
    const pending =
      f.classification_pending ||
      f.allocation_pending ||
      (kind === "overload_system" && (f.quota === null || f.unknown > 0));
    const regular = pending
      ? null
      : kind === "contractual"
        ? f.regular
        : Math.max(0, f.regular - f.quota!);
    const parallel = pending
      ? null
      : kind === "contractual"
        ? f.parallel
        : Math.max(0, f.parallel - Math.max(0, f.quota! - f.regular));
    const unknown = f.allocation_pending ? null : f.unknown;
    const total = pending
      ? null
      : round(
          system === "regular"
            ? regular!
            : system === "parallel"
              ? parallel!
              : regular! + parallel! + (kind === "contractual" ? f.unknown : 0),
        );
    // Keep unresolved members visible: missing data is neither zero nor an empty report.
    if (total === 0 && !pending && f.unknown === 0) return [];
    return [
      {
        identity_id: f.identity_id,
        instructor: f.instructor,
        university_number: f.university_number,
        rank: f.rank,
        quota: kind === "contractual" ? "لا ينطبق" : f.quota,
        assigned_regular: round(f.regular),
        assigned_parallel: round(f.parallel),
        regular: regular === null ? null : round(regular),
        parallel: parallel === null ? null : round(parallel),
        unknown,
        total,
        project: round(f.project),
        status: f.classification_pending
          ? "بانتظار اعتماد نوع التوظيف أو التعاقد"
          : f.allocation_pending
            ? "بانتظار توزيع ساعات التدريس المشترك"
            : kind === "overload_system" && f.quota === null
              ? "بانتظار اعتماد النصاب"
              : f.unknown > 0
                ? "ساعات مشتركة أو بلا نظام محدد؛ يلزم تحديد توزيعها"
                : "مكتمل",
      },
    ];
  });
}

export function systemHoursHeaders(kind: SystemHoursKind, system: SystemHoursFilter) {
  const label = kind === "contractual" ? "تعاقدية" : "زائدة";
  return [
    { key: "instructor", label: "المحاضر" },
    { key: "university_number", label: "الرقم الجامعي" },
    { key: "rank", label: "الرتبة" },
    ...(kind === "overload_system"
      ? [
          { key: "quota", label: "صافي النصاب" },
          { key: "assigned_regular", label: "المسند عام" },
          { key: "assigned_parallel", label: "المسند موازي" },
        ]
      : []),
    ...(system !== "parallel" ? [{ key: "regular", label: `${label} عام` }] : []),
    ...(system !== "regular" ? [{ key: "parallel", label: `${label} موازي` }] : []),
    { key: "unknown", label: "ساعات غير موزعة على النظامين" },
    { key: "total", label: "الإجمالي المؤكد للنظام المختار" },
    { key: "status", label: "الحالة" },
  ];
}

/** Aggregate the visible lecturer rows, without turning unresolved hours into zeros. */
export function buildSystemHoursRankRows(rows: readonly SystemHoursRow[]): SystemHoursRow[] {
  const groups = new Map<string, SystemHoursRow[]>();
  for (const row of rows) {
    const rank = systemHoursRankLabel(row.rank);
    const group = groups.get(rank) ?? [];
    group.push(row);
    groups.set(rank, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, "ar"))
    .map(([rank, group]) => {
      const confirmed = (key: string) => {
        const values = group
          .map((row) => row[key])
          .filter((v): v is number => typeof v === "number");
        return values.length ? round(values.reduce((sum, value) => sum + value, 0)) : null;
      };
      const incomplete = group.filter((row) => row.status !== "مكتمل").length;
      return {
        rank,
        lecturer_count: group.length,
        regular: confirmed("regular"),
        parallel: confirmed("parallel"),
        unknown: confirmed("unknown"),
        total: confirmed("total"),
        incomplete,
        status: incomplete ? "إجمالي مؤكد جزئيًا؛ توجد بيانات تحتاج استكمالًا" : "مكتمل",
      };
    });
}

export function systemHoursRankHeaders(system: SystemHoursFilter) {
  return [
    { key: "rank", label: "الرتبة العلمية" },
    { key: "lecturer_count", label: "عدد المحاضرين" },
    ...systemHoursHeaders("contractual", system).filter((h) =>
      ["regular", "parallel", "unknown", "total"].includes(h.key),
    ),
    { key: "incomplete", label: "سجلات تحتاج استكمالًا" },
    { key: "status", label: "الحالة" },
  ];
}
