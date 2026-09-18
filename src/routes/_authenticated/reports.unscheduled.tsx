import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  ReportSection,
  ReportDataTable,
  type ReportColumn,
} from "@/components/reports/report-section";
import {
  buildDeliveryGroupCoverage,
  componentTypeLabel,
} from "@/lib/reports/program-timetable-coverage";
import { fetchCohortDeliveryGroupCatalog } from "@/lib/reports/queries/delivery-group-coverage-queries";
import { filterRowsBySearch } from "@/lib/reports/search";
import { readAllReportRows } from "@/lib/reports/read-all";
import { fetchLatestUnplacedReasons } from "@/lib/reports/queries/operational-queries";

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
  { key: "students", label: "عدد الطلاب", numeric: true },
  { key: "coverage_pct", label: "نسبة التغطية %", numeric: true },
  { key: "reason", label: "حالة التغطية" },
  { key: "scheduler_reason", label: "سبب آخر محاولة جدولة" },
  { key: "scheduler_reason_detail", label: "تفصيل سبب الجدولة" },
];

type UnscheduledDisplayRow = Record<string, string | number | null>;

const unscheduledText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function schedulerReasonLabel(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "لا يوجد سبب مسجل من تشغيل تلقائي";
  const lower = value.toLowerCase();
  if (lower.includes("room_conflict")) return "تعارض قاعة";
  if (lower.includes("instructor_conflict")) return "تعارض محاضر";
  if (lower.includes("cohort") || lower.includes("delivery_group") || value.includes("الدفعة"))
    return "تعارض طلاب / مجموعة تدريس";
  if (lower.includes("capacity")) return "سعة القاعة غير كافية";
  if (lower.includes("availability")) return "قيد توافر المحاضر أو القاعة";
  if (lower.includes("day") && lower.includes("limit")) return "تجاوز حد أيام الحضور";
  if (lower.includes("hours") || lower.includes("daily")) return "تجاوز حد الساعات";
  return "لم يوجد موضع يحقق القيود";
}

function CoverageCell({ row }: { row: UnscheduledDisplayRow }) {
  return (
    <div className="min-w-[135px] space-y-0.5 leading-5">
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">المطلوب</span>
        <b className="tabular-nums">{unscheduledText(row.required)} س</b>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">المجدول</span>
        <span className="tabular-nums">{unscheduledText(row.scheduled)} س</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">المتبقي</span>
        <b className="tabular-nums">{unscheduledText(row.missing)} س</b>
      </div>
      <div className="pt-0.5 text-[10px] text-muted-foreground">
        التغطية: {unscheduledText(row.coverage_pct)}%
      </div>
    </div>
  );
}

function UnscheduledContextCell({ row }: { row: UnscheduledDisplayRow }) {
  return (
    <div className="min-w-[150px] space-y-0.5 leading-5">
      <div className="font-semibold">{unscheduledText(row.cohort)}</div>
      <div className="text-[11px] text-muted-foreground">
        {unscheduledText(row.group)} · {unscheduledText(row.component)}
      </div>
      <div className="text-[10px] text-muted-foreground">{unscheduledText(row.students)} طالب</div>
    </div>
  );
}

function UnscheduledReasonCell({ row }: { row: UnscheduledDisplayRow }) {
  return (
    <div className="min-w-[190px] space-y-1 leading-5">
      <div className="font-semibold">{unscheduledText(row.scheduler_reason)}</div>
      <div className="text-[11px] text-muted-foreground">{unscheduledText(row.reason)}</div>
      {row.scheduler_reason_detail && (
        <div className="text-[10px] text-muted-foreground">
          {unscheduledText(row.scheduler_reason_detail)}
        </div>
      )}
    </div>
  );
}

function compactUnscheduledColumns(): ReportColumn<UnscheduledDisplayRow>[] {
  return [
    { key: "course", label: "المقرر", className: "w-[28%]" },
    {
      key: "cohort",
      label: "الدفعة والمجموعة",
      className: "w-[19%]",
      render: (row) => <UnscheduledContextCell row={row} />,
    },
    { key: "instructor", label: "المحاضر", className: "w-[17%]" },
    {
      key: "missing",
      label: "تغطية الساعات",
      className: "w-[16%]",
      render: (row) => <CoverageCell row={row} />,
    },
    {
      key: "scheduler_reason",
      label: "سبب النقص / التعذر",
      className: "w-[25%]",
      render: (row) => <UnscheduledReasonCell row={row} />,
    },
  ];
}

function Page() {
  const ctx = useReportContext({ fixedStudySystem: "all" });
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["report-unscheduled-v2", ctx.collegeId, ctx.termId, ctx.versionId],
    enabled: !!ctx.collegeId && !!ctx.termId && !!ctx.selectedVersion,
    queryFn: async () => {
      const collegeId = ctx.collegeId!;
      const [cohorts, sessions, latestRun] = await Promise.all([
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
            .select("id, delivery_group_id, day_of_week, start_time, end_time")
            .eq("college_id", collegeId)
            .eq("schedule_version_id", ctx.selectedVersion!.id)
            .or("replaced_by_split.is.null,replaced_by_split.eq.false")
            .order("id")
            .range(from, to),
        ),
        fetchLatestUnplacedReasons(ctx.selectedVersion!.id),
      ]);
      const groups = await fetchCohortDeliveryGroupCatalog({
        collegeId,
        cohortIds: cohorts.map((c) => c.id),
      });
      const assignments = await readAllReportRows((from, to) =>
        supabase
          .from("teaching_assignments")
          .select("id, delivery_group_id")
          .eq("college_id", collegeId)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      );
      const assignmentIdsByGroup = new Map<string, string[]>();
      for (const assignment of assignments) {
        if (!assignment.delivery_group_id) continue;
        const ids = assignmentIdsByGroup.get(assignment.delivery_group_id) ?? [];
        ids.push(assignment.id);
        assignmentIdsByGroup.set(assignment.delivery_group_id, ids);
      }
      const unplaced = Array.isArray(latestRun?.unplaced)
        ? (latestRun.unplaced as Array<{ teaching_assignment_id?: string | null; reason?: string }>)
        : [];
      const reasonByAssignment = new Map(
        unplaced
          .filter((item) => item.teaching_assignment_id)
          .map((item) => [String(item.teaching_assignment_id), String(item.reason ?? "")]),
      );
      const coverage = buildDeliveryGroupCoverage({
        groups,
        sessions,
        cohortLabels: new Map(cohorts.map((c) => [c.id, c.code ?? "—"])),
      });
      return {
        totalGroups: groups.length,
        lastRunAt: latestRun?.created_at ?? null,
        rows: coverage.rows
          .filter((g) => g.scheduledHours + 0.01 < g.requiredHours)
          .map((g) => {
            const assignmentReasons = (assignmentIdsByGroup.get(g.id) ?? [])
              .map((id) => reasonByAssignment.get(id))
              .filter((reason): reason is string => !!reason);
            const rawReason = [...new Set(assignmentReasons)].join(" | ");
            const missing = Number(Math.max(0, g.requiredHours - g.scheduledHours).toFixed(2));
            const coveragePercent =
              g.requiredHours > 0
                ? Math.min(100, Math.round((g.scheduledHours / g.requiredHours) * 100))
                : 100;
            return {
              course: [g.courseCode, g.courseName].filter(Boolean).join(" — "),
              cohort: g.cohortLabel ?? "—",
              group: g.groupCode ?? "—",
              component: componentTypeLabel(g.componentType),
              students: g.expectedStudents ?? 0,
              required: g.requiredHours,
              scheduled: g.scheduledHours,
              missing,
              coverage_pct: coveragePercent,
              instructor: g.instructorName ?? "غير مسند",
              reason: !g.instructorName
                ? "الإسناد التدريسي غير مكتمل"
                : g.scheduledHours
                  ? "تغطية جزئية"
                  : "لم تُسكن المجموعة",
              scheduler_reason: rawReason
                ? schedulerReasonLabel(rawReason)
                : !g.instructorName
                  ? "يلزم استكمال الإسناد قبل الجدولة"
                  : "لا يوجد سبب مسجل من آخر تشغيل",
              scheduler_reason_detail: rawReason || "—",
            };
          }),
      };
    },
  });
  const rows = filterRowsBySearch(query.data?.rows ?? [], search);
  return (
    <ReportShell
      title="المحاضرات غير المجدولة"
      description="مجموعات التدريس التي ما زالت تحتاج ساعات، مع نسبة التغطية وسبب النقص وسبب تعذر آخر محاولة جدولة تلقائية عند توفره."
      reportContext={ctx}
      rows={rows}
      headers={columns}
      filename="unscheduled_groups"
      printOrientation="landscape"
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
        hint={
          query.data?.lastRunAt
            ? `آخر أسباب الجدولة من تشغيل: ${new Date(query.data.lastRunAt).toLocaleString("ar")}`
            : "لا يوجد تشغيل تلقائي محفوظ لهذه النسخة؛ يعرض التقرير حالة التغطية الحالية."
        }
      >
        <ReportDataTable
          rows={rows}
          columns={compactUnscheduledColumns() as unknown as ReportColumn<(typeof rows)[number]>[]}
          primaryColumnLimit={6}
          minWidthClassName="min-w-[760px]"
          caption="الساعات غير المجدولة لكل مجموعة"
        />
      </ReportSection>
    </ReportShell>
  );
}
