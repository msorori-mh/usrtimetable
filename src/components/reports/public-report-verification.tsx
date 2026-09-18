import { useEffect, useState } from "react";
import { USR_UNIVERSITY_LOGO_SRC, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { REPORT_KIND_LABELS, UUID_PATTERN } from "@/lib/reports/verification-link";
import { resolveReportVerification, type ReportVerification } from "@/lib/reports/verification-api";

/** Public metadata only; deliberately no AppLayout, account menu or internal links. */
export function PublicReportVerification({ receiptId }: { receiptId: string | null }) {
  const [result, setResult] = useState<ReportVerification | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    if (!receiptId || !UUID_PATTERN.test(receiptId)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void resolveReportVerification(receiptId)
      .then((data) => {
        if (!cancelled) setResult(data ?? { available: false });
      })
      .catch(() => {
        if (!cancelled) setError("تعذر الاتصال بخدمة التحقق. حاول مجددًا.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [receiptId, attempt]);
  const date = (value?: string) =>
    value ? new Date(value).toLocaleString("ar-YE", { timeZone: "Asia/Aden" }) : "—";
  const fields = result?.available
    ? [
        ["الجامعة", USR_UNIVERSITY_NAME_AR],
        ["الكلية", result.college_name],
        [
          "نوع التقرير",
          result.report_kind ? REPORT_KIND_LABELS[result.report_kind] : "تقرير أكاديمي",
        ],
        ["نسخة الجدول", result.version_name],
        ["الفصل الدراسي", result.term_name],
        ["الحالة", "منشورة"],
        ["إصدار مرجع التحقق", date(result.issued_at)],
        ["آخر تحديث للنسخة", date(result.version_updated_at)],
      ]
    : [];
  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b-4 border-amber-500 bg-sky-950 p-6 text-white">
          <img
            src={USR_UNIVERSITY_LOGO_SRC}
            alt={USR_UNIVERSITY_NAME_AR}
            className="mx-auto mb-4 h-20 w-20 object-contain"
          />
          <h1 className="text-center text-2xl font-bold">التحقق من التقرير</h1>
          <p className="mt-2 text-center text-sm">{USR_UNIVERSITY_NAME_AR}</p>
        </header>
        <div className="space-y-5 p-6" aria-live="polite">
          <p className="text-sm text-slate-600">
            صفحة مستقلة تعرض بيانات مرجع التقرير وحالة نسخته فقط. لا تمنح صلاحية دخول إلى المنصة.
          </p>
          {loading ? (
            <p role="status">جارٍ التحقق من المرجع…</p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button
                className="mt-3 rounded-lg bg-sky-900 px-4 py-2 text-white"
                onClick={() => setAttempt((v) => v + 1)}
              >
                إعادة المحاولة
              </button>
            </div>
          ) : result?.available ? (
            <>
              <p
                className={`rounded-lg border p-3 font-semibold ${result.unchanged && result.is_latest ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
              >
                {result.unchanged && result.is_latest
                  ? "مرجع معروف — النسخة منشورة ولم تتغير منذ إصدار المرجع"
                  : !result.unchanged
                    ? "تغيرت النسخة بعد إصدار هذا المرجع؛ اطلب تقريرًا محدثًا"
                    : "توجد نسخة منشورة أحدث لهذا الفصل"}
              </p>
              <dl className="divide-y divide-slate-100">
                {fields.map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-3 sm:grid-cols-[160px_1fr]">
                    <dt className="text-slate-600">{label}</dt>
                    <dd className="break-words font-semibold">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-slate-500">
                التواريخ بتوقيت اليمن. التحقق يثبت وجود مرجع النسخة وحالتها، ولا يصادق على كل
                محتويات نسخة ورقية قد تكون عُدلت.
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h2 className="font-bold">لا تتوفر بيانات تحقق عامة لهذا الرابط</h2>
              <p className="mt-2 text-sm">
                قد يكون المرجع غير صحيح، أو التقرير غير منشور، أو أُوقف نشر نسخته. اطلب نسخة منشورة
                حديثة من الجهة المصدرة.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
