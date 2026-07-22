import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  ListChecks,
  XCircle,
} from "lucide-react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DEPENDENCY_MAP_DOC,
  LEGACY_RESIDUE,
  MIGRATION_MANIFEST,
  SHARED_GROUPS_NOTE,
  overallStatus,
  runAllChecks,
  type CheckStatus,
  type ReadinessCheckResult,
} from "@/lib/readiness/checks";

/**
 * Readiness Dashboard — 100% READ-ONLY (A4-READINESS-DASHBOARD-DESIGN-01).
 * Every check is a SELECT under the caller's RLS; this screen never writes and
 * never calls an RPC. "الخطوة التالية" links only navigate to the owning screen.
 * Disabled-CTA hints for read_only are UX only — RLS/RPC remains the boundary.
 */
export const Route = createFileRoute("/_authenticated/readiness-dashboard")({
  head: () => ({ meta: [{ title: "جاهزية الإطلاق" }] }),
  component: ReadinessDashboardPage,
});

function StatusIcon({ result }: { result: ReadinessCheckResult }) {
  if (result.status === "PASS") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (result.status === "UNKNOWN") return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
  if (result.def.severity === "WARN") return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function statusLabel(result: ReadinessCheckResult): string {
  if (result.status === "PASS") return "جاهز";
  if (result.status === "UNKNOWN") return "غير متاح";
  return result.def.severity === "WARN" ? "تحذير" : "مانع";
}

function overallBadge(status: CheckStatus) {
  if (status === "BLOCKED")
    return (
      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700">
        غير جاهز — توجد موانع
      </Badge>
    );
  if (status === "UNKNOWN")
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
        جاهزية غير مؤكدة — فحوصات غير متاحة
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
      جاهز وفق الفحوصات الحالية
    </Badge>
  );
}

function CheckRow({
  result,
  canManage,
}: {
  result: ReadinessCheckResult;
  canManage: boolean;
}) {
  const { def } = result;
  const ctaDisabled = def.requiresManage && !canManage;
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border/60 py-3 last:border-0">
      <StatusIcon result={result} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {def.id} — {def.title}
          </span>
          <Badge variant="outline" className="text-[11px]">
            {statusLabel(result)}
          </Badge>
          {result.missing !== null && result.total !== null && (
            <span className="text-xs text-muted-foreground">
              {result.missing} / {result.total}
            </span>
          )}
        </div>
        {result.note && <p className="mt-1 text-xs text-muted-foreground">{result.note}</p>}
      </div>
      <div className="shrink-0 text-sm">
        {def.nextStep.to && !ctaDisabled ? (
          <Link to={def.nextStep.to} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
            الخطوة التالية: {def.nextStep.label}
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        ) : def.nextStep.to && ctaDisabled ? (
          <span
            className="inline-flex items-center gap-1 text-muted-foreground"
            title="يتطلب صلاحية إدارة الكلية — إخفاء الزر ليس تفويضًا؛ الإنفاذ في RLS/RPC"
          >
            الخطوة التالية: {def.nextStep.label} (تتطلب صلاحية إدارة)
          </span>
        ) : (
          <span className="text-muted-foreground">الخطوة التالية: {def.nextStep.label}</span>
        )}
      </div>
    </li>
  );
}

function ReadinessDashboardPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();

  const { data: results, isLoading } = useQuery({
    queryKey: ["readiness-dashboard", active?.id],
    enabled: Boolean(active),
    queryFn: () => runAllChecks(active!.id),
  });

  const lane1 = (results ?? []).filter((r) => r.def.lane === 1);
  const overall = results ? overallStatus(results) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <ListChecks className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">جاهزية الإطلاق</h1>
          <p className="text-sm text-muted-foreground">
            ما الذي يمنع بناء واعتماد ونشر جدول حقيقي بالضبط — وما الخطوة التالية الدقيقة؟ (قراءة
            فقط؛ الفشل يُغلق لا يُتجاوز.)
          </p>
        </div>
        {overall && overallBadge(overall)}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CollegeSwitcher />
        {active && (
          <span className="text-sm text-muted-foreground">
            الكلية: {active.name}
          </span>
        )}
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية للبدء.</Card>
      ) : isLoading || !results ? (
        <Card className="p-6 text-center text-muted-foreground">جارٍ تشغيل فحوصات الجاهزية…</Card>
      ) : (
        <>
          {/* Lane 1 — مسلسل الإطلاق (workflow rail, locked order) */}
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold">مسلسل الإطلاق</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              بالترتيب المعتمد: الخطة ← الدفعة ← المنهج ← مجموعات المحاضرات والمعامل ← الإسناد
              التدريسي ← أيام وفترات الدوام ← التوفر ← أعداد الدفعات المعتمدة للجدولة ← السعة ←
              التعارضات ← دورة الحياة. {SHARED_GROUPS_NOTE}
            </p>
            <ul>
              {lane1.map((r) => (
                <CheckRow key={r.def.id} result={r} canManage={canManage} />
              ))}
            </ul>
          </Card>

          {/* Lane 2 — الجاهزية التفصيلية (existing /data-readiness reused unchanged) */}
          <Card className="p-5">
            <h2 className="mb-2 text-base font-semibold">الجاهزية التفصيلية</h2>
            <p className="text-sm text-muted-foreground">
              بطاقات الجاهزية التفصيلية (الخطط/الموارد/التوفر/الجدولة) متوفرة بدون تغيير في{" "}
              <Link to="/data-readiness" className="text-primary underline-offset-4 hover:underline">
                جاهزية البيانات
              </Link>{" "}
              وفي{" "}
              <Link
                to="/reports/data-readiness"
                className="text-primary underline-offset-4 hover:underline"
              >
                تقرير جاهزية البيانات
              </Link>
              .
            </p>
          </Card>

          {/* Lane 3 — حواجز النظام والترحيل */}
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold">حواجز النظام والترحيل</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              مرآة للقراءة فقط لحقائق STATE.json — لا يُعرض أي ترحيل كمطبَّق دون دليل عن بُعد.
              المرجع: <span className="font-mono text-[11px]">{DEPENDENCY_MAP_DOC}</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-right">الترحيل</th>
                    <th className="px-3 py-2 text-right">الترتيب</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                    <th className="px-3 py-2 text-right">البوابة</th>
                    <th className="px-3 py-2 text-right">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {MIGRATION_MANIFEST.map((m) => (
                    <tr key={m.file} className="border-t">
                      <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">
                        {m.file}
                      </td>
                      <td className="px-3 py-2">{m.order ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={
                            m.status === "HELD"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                              : "border-border text-muted-foreground"
                          }
                        >
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{m.gate}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{m.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium text-amber-700">بقايا Legacy (مرآة STATE.json)</p>
              <p className="mt-1 text-muted-foreground">
                {LEGACY_RESIDUE.orphanTeachingAssignments} إسنادًا تدريسيًا يتيمًا يحمل section_id +{" "}
                {LEGACY_RESIDUE.orphanCourseOfferingSections} سجلات course_offering_sections يتيمة —
                خطة المعالجة:{" "}
                <span className="font-mono text-[11px]">{LEGACY_RESIDUE.remediationPlanDoc}</span>{" "}
                (بوابة APPROVE_LEGACY_DATA_REMEDIATION).
              </p>
            </div>
            <ul className="mt-4">
              {results
                .filter((r) => r.def.lane === 3)
                .map((r) => (
                  <CheckRow key={r.def.id} result={r} canManage={canManage} />
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
