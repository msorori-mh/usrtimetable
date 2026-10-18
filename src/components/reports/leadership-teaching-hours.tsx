import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { setActiveCollegeId } from "@/hooks/use-colleges";
import type { LeadershipCollege } from "@/lib/reports/leadership";
import { fetchTeachingCoverage, fetchSystemHours } from "@/lib/reports/fetch-teaching-coverage";
import { summarizeCoverage, SYSTEM_LABELS } from "@/lib/reports/teaching-coverage";
import { buildSystemHoursRows, type SystemHoursFilter } from "@/lib/reports/system-hours";
import { CoverageSelect } from "./teaching-coverage-report";

export function LeadershipTeachingHours({
  colleges,
  viewerKey,
  revision,
  stale = false,
}: {
  colleges: LeadershipCollege[];
  viewerKey: string;
  revision?: string;
  stale?: boolean;
}) {
  const [system, setSystem] = useState<SystemHoursFilter>("all");
  const scope = colleges.map((c) => ({
    id: c.college_id,
    termId: c.term_state === "ready" ? c.term_id : null,
    name: c.college,
  }));
  const query = useQuery({
    queryKey: ["leadership-teaching-hours", viewerKey, scope, revision],
    enabled: scope.length > 0 && !stale,
    retry: false,
    queryFn: async () => {
      const results = [];
      // Bound concurrent database work; every individual RPC enforces college access.
      for (const c of scope) {
        if (!c.termId) {
          results.push({ ...c, data: null });
          continue;
        }
        const [coverage, overload, contractual] = await Promise.all([
          fetchTeachingCoverage(c.id, c.termId),
          fetchSystemHours(c.id, c.termId, "overload_system"),
          fetchSystemHours(c.id, c.termId, "contractual"),
        ]);
        results.push({ ...c, data: { coverage, overload, contractual } });
      }
      return results;
    },
  });
  const loading = query.isFetching || query.isPending;
  const rows = !loading && !query.error && !stale ? (query.data ?? []) : [];
  const amount = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return (
    <section
      className="mt-4 rounded-xl border bg-card p-4"
      aria-label="تغطية التدريس والساعات الزائدة والتعاقدية"
      data-testid="leadership-teaching-hours"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-bold">تغطية التدريس والساعات الزائدة والتعاقدية</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            ساعات الإسناد الأسبوعية الحالية للفترة المختارة؛ الساعات المنفذة وأجور الصرف في تقرير
            مستقل.
          </p>
        </div>
        <div className="report-no-print">
          <CoverageSelect
            label="نظام ساعات التدريس"
            value={system}
            onChange={(v) => setSystem(v as SystemHoursFilter)}
            items={Object.entries(SYSTEM_LABELS).filter(([k]) => k !== "unknown")}
          />
        </div>
      </div>
      <p className="mb-3 text-xs leading-6">
        التغطية تخص الكلية المستفيدة. الزيادة تخص أعضاء الكلية الأصلية بعد خصم نصابهم مرة واحدة من
        عبئهم الجامعي. لذلك لا تُجمع الزيادة مع مصادر التغطية. الساعات غير المحسومة لا تُعامل كصفر.
      </p>
      {stale ? (
        <p role="alert">تعذر تحديث نطاق اللوحة؛ حدّث الصفحة لعرض الساعات.</p>
      ) : query.error ? (
        <div role="alert">
          تعذر تحميل الساعات؛ لم تُعرض مجاميع جزئية.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            إعادة المحاولة
          </button>
        </div>
      ) : loading ? (
        <p role="status">جارٍ تحميل الساعات…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">ساعات {SYSTEM_LABELS[system]} حسب الكلية</caption>
            <thead>
              <tr>
                {[
                  "الكلية",
                  "من داخل الكلية",
                  "من كليات أخرى",
                  "بتعاقد خارجي",
                  "تصنيف غير محسوم",
                  "الزائدة المؤكدة",
                  "التعاقدية المؤكدة",
                  "حالة البيانات",
                  "التفاصيل",
                ].map((h) => (
                  <th key={h} className="border-b p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const sums = c.data
                  ? summarizeCoverage(
                      c.data.coverage.filter((r) => system === "all" || r.study_system === system),
                    )
                  : null;
                const overtime = c.data
                  ? buildSystemHoursRows(c.data.overload, "overload_system", system)
                  : [];
                const contracts = c.data
                  ? buildSystemHoursRows(c.data.contractual, "contractual", system)
                  : [];
                const pending =
                  overtime.filter((r) => r.status !== "مكتمل").length +
                  contracts.filter((r) => r.status !== "مكتمل").length;
                return (
                  <tr key={c.id}>
                    <th className="border-b p-2 font-medium">{c.name}</th>
                    {[
                      sums?.internal,
                      sums?.other_college,
                      sums?.contractual,
                      sums?.unknown,
                      c.data
                        ? amount(
                            overtime.reduce(
                              (n, r) => n + (typeof r.total === "number" ? r.total : 0),
                              0,
                            ),
                          )
                        : undefined,
                      c.data
                        ? amount(
                            contracts.reduce(
                              (n, r) => n + (typeof r.total === "number" ? r.total : 0),
                              0,
                            ),
                          )
                        : undefined,
                    ].map((n, index) => (
                      <td key={index} className="border-b p-2 tabular-nums">
                        {n ?? "—"}
                      </td>
                    ))}
                    <td className="border-b p-2 text-xs">
                      {!c.data
                        ? "الفصل غير محسوم"
                        : pending || sums?.pendingMembers || sums?.unknown
                          ? "توجد بيانات تحتاج استكمالًا؛ المجاميع مؤكدة جزئيًا"
                          : "مكتمل"}
                    </td>
                    <td className="border-b p-2">
                      {c.termId && (
                        <div className="report-no-print flex flex-col gap-2">
                          {(
                            [
                              ["coverage", "مصادر التغطية"],
                              ["overload_system", "الزائدة"],
                              ["contractual", "التعاقدية"],
                            ] as const
                          ).map(([report, label]) => (
                            <Link
                              key={report}
                              to="/reports/academic-affairs"
                              search={{ report, termId: c.termId! }}
                              onClick={() => setActiveCollegeId(c.id)}
                              className="underline"
                            >
                              {label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
