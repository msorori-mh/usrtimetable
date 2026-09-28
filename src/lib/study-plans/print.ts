export interface PrintablePlan {
  id: string;
  name: string;
  code: string;
  version: string;
  effective_year: number | null;
  is_active: boolean;
  programName: string;
  departmentName: string;
}
export interface PrintableCourse {
  id: string;
  semester: number;
  is_required: boolean;
  course: { code: string; name: string; credit_hours: number | null } | null;
  level: { name: string; level_number: number } | null;
  components: { component_type: string; weekly_contact_hours: number }[];
}
const escape = (value: unknown) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const labels: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};
export function buildStudyPlansPrint(
  collegeName: string,
  plans: { plan: PrintablePlan; courses: PrintableCourse[] }[],
) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الخطط الدراسية — ${escape(collegeName)}</title><style>
  @page{size:A4 portrait;margin:14mm}body{font:14px Arial,sans-serif;color:#111;line-height:1.6;margin:24px}h1{font-size:22px}h2{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #aaa;padding:6px;text-align:right;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}section+section{break-before:page}h2,p{break-after:avoid}.meta{color:#444}.code{direction:ltr;unicode-bidi:embed}@media print{body{margin:0}}</style></head><body>${plans
    .map(({ plan, courses }) => {
      const sorted = [...courses].sort(
        (a, b) =>
          (a.level?.level_number ?? 999) - (b.level?.level_number ?? 999) ||
          a.semester - b.semester ||
          (a.course?.code ?? "").localeCompare(b.course?.code ?? ""),
      );
      return `<section><h1>${escape(collegeName)} — الخطط الدراسية</h1><p>القسم: ${escape(plan.departmentName)} · البرنامج: ${escape(plan.programName)}</p><h2>${escape(plan.name)}</h2><p class="meta">الرمز: ${escape(plan.code)} · الإصدار: ${escape(plan.version)} · سنة السريان: ${escape(plan.effective_year)} · ${plan.is_active ? "سارية" : "غير سارية"}</p><p>عدد المقررات: ${courses.length}</p>${courses.length ? `<table><thead><tr>${["المستوى", "الفصل", "رمز المقرر", "المقرر", "النوع", "الساعات المعتمدة", "الساعات الأسبوعية حسب المكوّن"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${sorted.map((c) => `<tr><td>${escape(c.level?.name)}</td><td>${escape(c.semester)}</td><td class="code">${escape(c.course?.code)}</td><td>${escape(c.course?.name)}</td><td>${c.is_required ? "إلزامي" : "اختياري"}</td><td>${escape(c.course?.credit_hours)}</td><td>${c.components.length ? c.components.map((x) => `${escape(labels[x.component_type] ?? x.component_type)}: ${escape(x.weekly_contact_hours)}`).join("، ") : "غير محددة"}</td></tr>`).join("")}</tbody></table>` : "<p>لا توجد مقررات مسجلة لهذه الخطة.</p>"}</section>`;
    })
    .join("")}</body></html>`;
}
