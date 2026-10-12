export type PayKind = "overload" | "contractual";
export type PaySystem = "regular" | "parallel";
export const PAY_KINDS = {
  overload: "ساعات زائدة",
  contractual: "ساعات تعاقدية",
};
export const PAY_SYSTEMS = { regular: "العام", parallel: "الموازي" };
export interface PayRate {
  id: string;
  rank: string;
  kind: PayKind;
  system: PaySystem;
  effective_from: string;
  hourly_rate: number;
  currency: string;
  decision_ref: string;
}
export interface PayEntry {
  id: string;
  identity_id: string;
  instructor_name: string;
  university_number: string | null;
  rank: string;
  department_id: string;
  department_name: string;
  program_id: string;
  program_name: string;
  kind: PayKind;
  system: PaySystem;
  work_date: string;
  starts_at: string;
  ends_at: string;
  actual_hours: number;
  payable_hours: number;
  approval_ref: string;
  note: string;
  status: "draft" | "approved" | "void";
  rate_id: string | null;
  hourly_rate: number | null;
  currency: string | null;
  amount: number | null;
  approved_at: string | null;
}
export interface PayData {
  terms: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    is_active: boolean;
  }[];
  programs: {
    id: string;
    name: string;
    department_id: string;
    department_name: string;
  }[];
  instructors: {
    id: string;
    name: string;
    rank: string | null;
    university_number: string | null;
    kind: PayKind | null;
  }[];
  rates: PayRate[];
  entries: PayEntry[];
}
// Shape validation is deliberately fail-closed: no incomplete result becomes a zero-value payment report.
export function parsePayData(value: unknown): PayData {
  if (!value || typeof value !== "object") throw new Error("تعذر قراءة بيانات الأجور");
  const data = value as PayData;
  for (const key of ["terms", "programs", "instructors", "rates", "entries"] as const)
    if (!Array.isArray(data[key])) throw new Error("بيانات الأجور غير مكتملة");
  for (const r of data.rates)
    if (
      !r.id ||
      !r.rank ||
      !PAY_KINDS[r.kind] ||
      !PAY_SYSTEMS[r.system] ||
      !Number.isFinite(r.hourly_rate) ||
      r.hourly_rate <= 0 ||
      !/^[A-Z]{3}$/.test(r.currency)
    )
      throw new Error("بيانات سعر الساعة غير صالحة");
  const ids = new Set<string>();
  for (const e of data.entries) {
    if (
      !e.id ||
      ids.has(e.id) ||
      !e.identity_id ||
      !e.instructor_name ||
      !e.program_id ||
      !PAY_KINDS[e.kind] ||
      !PAY_SYSTEMS[e.system] ||
      !["draft", "approved", "void"].includes(e.status) ||
      !Number.isFinite(e.actual_hours) ||
      !Number.isFinite(e.payable_hours) ||
      e.payable_hours <= 0 ||
      e.payable_hours > e.actual_hours
    )
      throw new Error("سجل التنفيذ غير مكتمل أو مكرر");
    if (
      e.status === "approved" &&
      (!e.rate_id ||
        !e.approved_at ||
        !e.currency ||
        typeof e.hourly_rate !== "number" ||
        e.hourly_rate <= 0 ||
        !Number.isFinite(e.hourly_rate) ||
        typeof e.amount !== "number" ||
        !Number.isFinite(e.amount) ||
        Math.abs(
          e.amount - Math.round((e.payable_hours * e.hourly_rate + Number.EPSILON) * 100) / 100,
        ) > 0.001)
    )
      throw new Error("مبلغ معتمد غير مكتمل أو غير مطابق للساعات والسعر");
    ids.add(e.id);
  }
  return data;
}
export function applicableRate(entry: PayEntry, rates: PayRate[]): PayRate | undefined {
  return rates
    .filter(
      (r) =>
        r.rank === entry.rank &&
        r.kind === entry.kind &&
        r.system === entry.system &&
        r.effective_from <= entry.work_date,
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}
export interface PayFilter {
  department: string;
  program: string;
  instructor: string;
  system: string;
  kind: string;
  from: string;
  to: string;
}
export function filterPayEntries(entries: PayEntry[], f: PayFilter) {
  return entries.filter(
    (e) =>
      (!f.department || e.department_id === f.department) &&
      (!f.program || e.program_id === f.program) &&
      (!f.instructor || e.identity_id === f.instructor) &&
      (!f.system || e.system === f.system) &&
      (!f.kind || e.kind === f.kind) &&
      (!f.from || e.work_date >= f.from) &&
      (!f.to || e.work_date <= f.to),
  );
}
export function payTotals(entries: PayEntry[]): Record<string, number> {
  const cents: Record<string, number> = {};
  for (const e of entries)
    if (e.status === "approved" && e.currency && e.amount !== null)
      cents[e.currency] = (cents[e.currency] ?? 0) + Math.round(e.amount * 100);
  return Object.fromEntries(Object.entries(cents).map(([currency, n]) => [currency, n / 100]));
}
export const PAY_HEADERS = [
  ["id", "رقم السجل"],
  ["instructor", "المحاضر"],
  ["university_number", "الرقم الجامعي"],
  ["rank", "الرتبة"],
  ["department", "القسم"],
  ["program", "البرنامج"],
  ["kind", "نوع الاستحقاق"],
  ["system", "النظام"],
  ["date", "تاريخ التنفيذ"],
  ["time", "الوقت"],
  ["actual", "الساعات المنفذة"],
  ["payable", "الساعات المستحقة المعتمدة"],
  ["rate", "أجرة الساعة"],
  ["currency", "العملة"],
  ["amount", "المستحق"],
  ["reference", "مرجع اعتماد التنفيذ"],
  ["approved_at", "تاريخ الاعتماد المالي"],
].map(([key, label]) => ({ key, label }));
export function payReportRows(entries: PayEntry[]) {
  return entries
    .filter((e) => e.status === "approved")
    .map((e) => ({
      id: e.id,
      instructor: e.instructor_name,
      university_number: e.university_number,
      rank: e.rank,
      department: e.department_name,
      program: e.program_name,
      kind: PAY_KINDS[e.kind],
      system: PAY_SYSTEMS[e.system],
      date: e.work_date,
      time: `${e.starts_at.slice(0, 5)}–${e.ends_at.slice(0, 5)}`,
      actual: e.actual_hours,
      payable: e.payable_hours,
      rate: e.hourly_rate,
      currency: e.currency,
      amount: e.amount,
      reference: e.approval_ref,
      approved_at: e.approved_at?.slice(0, 10) ?? "",
    }))
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, spreadsheetSafeText(value)]),
      ),
    );
}

/** The shared CSV exporter only quotes delimiters. Neutralize executable text
 * locally for this financial statement, keeping numeric amounts numeric. */
export function spreadsheetSafeText(value: string | number | null): string | number | null {
  return typeof value === "string" &&
    (/^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value))
    ? `'${value}`
    : value;
}
