import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import {
  buildDeliveryGroupCoverage,
  componentTypeLabel,
} from "@/lib/reports/program-timetable-coverage";
import { fetchCohortDeliveryGroupCatalog } from "@/lib/reports/queries/delivery-group-coverage-queries";
import { filterRowsBySearch } from "@/lib/reports/search";
import { readAllReportRows } from "@/lib/reports/read-all";

export const Route = createFileRoute("/_authenticated/reports/unscheduled")({
  head: () => ({ meta: [{ title: "المحاضرات غير المجدولة" }] }),
  component: Page,
});
const columns = [
  { key: "course", label: "المقرر" },
  { key: "cohort", label: "الدفعة" },
  { key: "group", label: "المجموعة" },
  { key: "required", label: "ساعات مطلوبة", numeric: true },
  { key: "scheduled", label: "ساعات مجدولة", numeric: true },
  { key: "missing", label: "ساعات ناقصة", numeric: true },
  { key: "component", label: "النوع", secondary: true },
  { key: "instructor", label: "المحاضر", secondary: true },
  { key: "reason", label: "حالة التغطية", secondary: true },
];
function Page() {
  const ctx = useReportContext();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["report-unscheduled-v2", ctx.collegeId, ctx.termId, ctx.versionId],
    enabled: !!ctx.collegeId && !!ctx.termId && !!ctx.selectedVersion,
    queryFn: async () => {
      const collegeId = ctx.collegeId!;
      const [cohorts, sessions] = await Promise.all([
        readAllReportRows((from, to) =>
          supabase
            .from("academic_cohorts")
            .select("id, code")
            .eq("college_id", collegeId)
            .eq("term_id", ctx.termId!)
            .or("active.is.null,active.eq.true")
            .order("id")
            .range(from, to),
        ),
        readAllReportRows((from, to) =>
          supabase
            .from("schedule_sessions")
            .select("id, delivery_group_id, start_time, end_time")
            .eq("college_id", collegeId)
            .eq("schedule_version_id", ctx.selectedVersion!.id)
            .or("replaced_by_split.is.null,replaced_by_split.eq.false")
            .order("id")
            .range(from, to),
        ),
      ]);
      const groups = await fetchCohortDeliveryGroupCatalog({
        collegeId,
        cohortIds: cohorts.map((c) => c.id),
      });
      const coverage = buildDeliveryGroupCoverage({
        groups,
        sessions,
        cohortLabels: new Map(cohorts.map((c) => [c.id, c.code ?? "—"])),
      });
      return {
        totalGroups: groups.length,
        rows: coverage.rows
          .filter((g) => g.scheduledHours + 0.01 < g.requiredHours)
          .map((g) => ({
            course: [g.courseCode, g.courseName].filter(Boolean).join(" — "),
            cohort: g.cohortLabel ?? "—",
            group: g.groupCode ?? "—",
            component: componentTypeLabel(g.componentType),
            required: g.requiredHours,
            scheduled: g.scheduledHours,
            missing: Number(Math.max(0, g.requiredHours - g.scheduledHours).toFixed(2)),
            instructor: g.instructorName ?? "غير مسند",
            reason: !g.instructorName
              ? "لم يُسند محاضر"
              : g.scheduledHours
                ? "تغطية جزئية — راجع الجدولة"
                : "لم تُسكن المجموعة — راجع الجدولة",
          })),
      };
    },
  });
  const rows = filterRowsBySearch(query.data?.rows ?? [], search);
  return (
    <ReportShell
      title="المحاضرات غير المجدولة"
      description="الساعات المتبقية لكل مجموعة تدريس نشطة في الفصل والنسخة المختارين، بما يشمل التغطية الجزئية."
      reportContext={ctx}
      rows={rows}
      headers={columns}
      filename="unscheduled_groups"
      isLoading={ctx.isLoading || query.isLoading}
      error={ctx.error ?? query.error}
      onRetry={() => void query.refetch()}
      notReadyMessage={ctx.selectedVersion ? undefined : "اختر فصلًا ونسخة جدول لعرض النواقص."}
      emptyMessage={
        search
          ? "لا نتائج مطابقة للبحث."
          : query.data?.totalGroups
            ? "اكتملت تغطية ساعات مجموعات التدريس النشطة."
            : "لم تُجهز مجموعات التدريس لهذا الفصل بعد."
      }
      kpis={[
        { label: "مجموعات ناقصة", value: rows.length },
        {
          label: "ساعات ناقصة",
          value: rows.reduce((sum, r) => sum + r.missing, 0).toFixed(2),
          tone: "warning",
        },
        { label: "مجموعات مفحوصة", value: query.data?.totalGroups ?? 0 },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          studySystem={false}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث بالمقرر أو الدفعة أو المجموعة أو المحاضر…",
          }}
          onClear={() => setSearch("")}
        />
      }
    >
      <ReportSection
        title="نواقص التغطية"
        hint="حالة التغطية تصف البيانات الحالية؛ أسباب تعذر التسكين التفصيلية تُراجع في صفحة الجدولة."
      >
        <ReportDataTable rows={rows} columns={columns} caption="الساعات غير المجدولة لكل مجموعة" />
      </ReportSection>
    </ReportShell>
  );
}
