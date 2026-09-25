import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters, ReportFilterField } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import { DeliveryGroupCoverageCard } from "@/components/reports/delivery-group-coverage-card";
import { Card } from "@/components/ui/card";
import {
  buildDeliveryGroupCoverage,
  componentTypeLabel,
  coverageFilterOption,
  coverageSummaryText,
  UNSCHEDULED_BADGE_AR,
  type CoverageSessionLike,
} from "@/lib/reports/program-timetable-coverage";
import { fetchCohortDeliveryGroupCatalog } from "@/lib/reports/queries/delivery-group-coverage-queries";
import { ProgramTimetablePrint } from "@/components/reports/program-timetable-print";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  mapRawSessions,
  timetableSessionsToRows,
  NEW_FLOW_TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import {
  fetchCohortDeliveryGroupLabels,
  fetchProgramLevelTimetableSessions,
} from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { useActiveCollege } from "@/hooks/use-colleges";
import {
  changeProgramReportFilter,
  deriveProgramTimetable,
  parseProgramReportSearch,
  programReportSearchParams,
  reconcileProgramReportScope,
  type ProgramReportReferences,
  type ProgramReportScope,
  type ProgramReportSelection,
} from "@/lib/reports/program-timetable-filters";
import type { ReportContext } from "@/lib/reports/types";

export const Route = createFileRoute("/_authenticated/reports/program-level-timetable")({
  head: () => ({ meta: [{ title: "تقرير جدول البرنامج/المستوى" }] }),
  component: Page,
});

const EMPTY_REFERENCES: ProgramReportReferences = {
  departments: [],
  programs: [],
  levels: [],
  cohorts: [],
};
const EMPTY_LABELS = {
  cohorts: new Map<string, string>(),
  deliveryGroups: new Map<string, string>(),
};
/**
 * Export/print headers: the timetable columns plus an explicit status column, so
 * a CSV/Excel export always shows unscheduled delivery groups instead of
 * implying the schedule is complete.
 */
const PROGRAM_TIMETABLE_EXPORT_HEADERS = [
  ...NEW_FLOW_TIMETABLE_TABLE_HEADERS,
  { key: "status", label: "الحالة" },
];

function Page() {
  const [initial] = useState(() =>
    parseProgramReportSearch(
      new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
    ),
  );
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
    initialFilters: initial.context,
  });
  return <ProgramLevelReport context={ctx} initialSelection={initial.selection} />;
}

function ProgramLevelReport({
  context: ctx,
  initialSelection,
}: {
  context: ReportContext;
  initialSelection: ProgramReportSelection;
}) {
  const { active } = useActiveCollege();
  const scope: ProgramReportScope = {
    collegeId: ctx.collegeId,
    termId: ctx.termId,
    versionId: ctx.versionId,
    studySystem: ctx.studySystem,
  };
  const [state, setState] = useState({ scope, selection: initialSelection });
  const scopedSelection = reconcileProgramReportScope(state.selection, state.scope, scope);
  // Adjust during render so no request or print can observe a stale dependent selection.
  if (
    Object.keys(scope).some(
      (key) =>
        scope[key as keyof ProgramReportScope] !== state.scope[key as keyof ProgramReportScope],
    )
  ) {
    setState({ scope, selection: scopedSelection });
  }

  const refsQuery = useQuery({
    queryKey: ["plt-references", ctx.collegeId, ctx.termId],
    enabled: !!ctx.collegeId && !!ctx.termId,
    queryFn: async (): Promise<ProgramReportReferences> => {
      const [departments, programs, levels, cohorts, plans] = await Promise.all([
        supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", ctx.collegeId!)
          .order("name"),
        supabase
          .from("academic_programs")
          .select("id, name, department_id")
          .eq("college_id", ctx.collegeId!)
          .order("name"),
        supabase
          .from("academic_levels")
          .select("id, name, program_id, level_number")
          .eq("college_id", ctx.collegeId!)
          .order("level_number"),
        supabase
          .from("academic_cohorts")
          .select(
            "id, code, program_id, level_id, term_id, study_system, entry_year, study_plan_id",
          )
          .eq("college_id", ctx.collegeId!)
          .eq("term_id", ctx.termId!)
          .order("code"),
        supabase.from("study_plans").select("id,name").eq("college_id", ctx.collegeId!),
      ]);
      for (const result of [departments, programs, levels, cohorts, plans])
        if (result.error) throw result.error;
      return {
        departments: departments.data ?? [],
        programs: programs.data ?? [],
        levels: levels.data ?? [],
        cohorts: (cohorts.data ?? []).map((c) => ({
          ...c,
          code:
            c.entry_year === null
              ? (plans.data?.find((p) => p.id === c.study_plan_id)?.name ?? c.code)
              : c.code,
        })),
      };
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ["plt-version-sessions", ctx.collegeId, ctx.versionId, ctx.studySystem],
    enabled: !!ctx.collegeId && !!ctx.selectedVersion,
    queryFn: async () => {
      const raw = await fetchProgramLevelTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        studySystem: ctx.studySystem,
      });
      const labels = await fetchCohortDeliveryGroupLabels(ctx.collegeId!, raw);
      return { raw, labels };
    },
  });
  const references = refsQuery.data ?? EMPTY_REFERENCES;
  const labels = sessionsQuery.data?.labels ?? EMPTY_LABELS;

  const catalogQuery = useQuery({
    queryKey: [
      "plt-delivery-group-catalog",
      ctx.collegeId,
      ctx.termId,
      ctx.versionId,
      references.cohorts.map((c) => c.id).join(","),
    ],
    enabled: !!ctx.collegeId && !!ctx.selectedVersion && references.cohorts.length > 0,
    queryFn: () =>
      fetchCohortDeliveryGroupCatalog({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        cohortIds: references.cohorts.map((c) => c.id),
      }),
  });

  const baseView = deriveProgramTimetable({
    references,
    scope,
    selection: scopedSelection,
    sessions: sessionsQuery.data?.raw ?? [],
    deliveryGroupLabels: labels.deliveryGroups,
  });
  const scopedCohortIds = new Set(baseView.scopedCohortIds);
  const cohortLabels = new Map(baseView.cohorts.map((c) => [c.id, c.name]));
  const coverage = buildDeliveryGroupCoverage({
    groups: (catalogQuery.data ?? []).filter((g) => scopedCohortIds.has(g.cohortId)),
    sessions: baseView.academicSessions as CoverageSessionLike[],
    cohortLabels: scopedSelection.cohortId === "all" ? cohortLabels : undefined,
  });
  const view = deriveProgramTimetable({
    references,
    scope,
    selection: scopedSelection,
    sessions: sessionsQuery.data?.raw ?? [],
    deliveryGroupLabels: labels.deliveryGroups,
    selectableDeliveryGroupIds: coverage.rows.map((r) => r.id),
  });
  const error = ctx.error ?? refsQuery.error ?? sessionsQuery.error ?? catalogQuery.error;
  const raw = error ? [] : view.sessions;
  const sessions = mapRawSessions(raw, labels);
  const timetableRows: Record<string, string | number>[] = timetableSessionsToRows(sessions).map(
    (r) => ({ ...r, status: "مجدول" }),
  );

  const selectedCoverageRow =
    view.selected.deliveryGroupId === "all"
      ? null
      : (coverage.rows.find((r) => r.id === view.selected.deliveryGroupId) ?? null);
  const unscheduledInView = selectedCoverageRow
    ? selectedCoverageRow.scheduledHours + 0.01 >= selectedCoverageRow.requiredHours
      ? []
      : [selectedCoverageRow]
    : coverage.incomplete;
  // Exports and print stay honest: unscheduled groups are appended as rows.
  const rows = error
    ? []
    : [
        ...timetableRows,
        ...unscheduledInView.map((g) => ({
          department: "",
          program: "",
          level: "",
          cohort: g.cohortLabel ?? "",
          delivery_group: g.groupCode ?? (g.groupNumber ? `G${g.groupNumber}` : "—"),
          course: [g.courseCode, g.courseName].filter(Boolean).join(" ") || "—",
          day: UNSCHEDULED_BADGE_AR,
          time: UNSCHEDULED_BADGE_AR,
          session_type: componentTypeLabel(g.componentType),
          instructor: g.instructorName ?? "",
          room: "",
          study_system: "",
          hours: Math.max(0, g.requiredHours - g.scheduledHours),
          status: g.scheduled ? "تغطية جزئية" : UNSCHEDULED_BADGE_AR,
        })),
      ];
  const totalHours = timetableRows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);
  const isLoading =
    ctx.isLoading || refsQuery.isLoading || sessionsQuery.isLoading || catalogQuery.isLoading;
  const change = (field: keyof ProgramReportSelection, value: string) =>
    setState({
      scope,
      selection: changeProgramReportFilter(view.selected, field, value),
    });
  const search = programReportSearchParams(scope, view.selected);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const qrUrl = `${origin}/reports/program-level-timetable?${search.toString()}`;
  const academicSummary = [
    references.departments.find((d) => d.id === view.selected.departmentId)?.name,
    view.programs.find((p) => p.id === view.selected.programId)?.name,
    view.levels.find((l) => l.value === view.selected.levelValue)?.label,
    view.cohorts.find((c) => c.id === view.selected.cohortId)?.name,
    selectedCoverageRow?.label,
  ]
    .filter(Boolean)
    .join(" · ");
  const filters: {
    field: keyof ProgramReportSelection;
    label: string;
    items: { id: string; name: string }[];
  }[] = [
    { field: "departmentId", label: "القسم", items: references.departments },
    { field: "programId", label: "البرنامج", items: view.programs },
    {
      field: "levelValue",
      label: "المستوى",
      items: view.levels.map((l) => ({ id: l.value, name: l.label })),
    },
    { field: "cohortId", label: "الدفعة الدراسية", items: view.cohorts },
    {
      field: "deliveryGroupId",
      label: "مجموعة المحاضرات/المعامل",
      items: coverage.rows.map(coverageFilterOption),
    },
  ];

  return (
    <ReportShell
      title="تقرير جدول البرنامج/المستوى"
      description={`${coverageSummaryText(coverage.summary)} · ${sessions.length} محاضرة مجدولة (${totalHours.toFixed(2)} ساعة).`}
      filterSummary={[ctx.filterSummary, academicSummary].filter(Boolean).join(" · ")}
      reportContext={ctx}
      filename="program_level_timetable"
      rows={rows}
      headers={PROGRAM_TIMETABLE_EXPORT_HEADERS}
      isLoading={isLoading}
      error={error}
      onRetry={() => {
        void refsQuery.refetch();
        void sessionsQuery.refetch();
        void catalogQuery.refetch();
      }}
      notReadyMessage={
        !ctx.termId
          ? "اختر الفصل الدراسي لعرض جدول البرنامج/المستوى."
          : !ctx.selectedVersion
            ? "اختر نسخة جدول لعرض المحاضرات."
            : undefined
      }
      kpis={[
        { label: "مجموعات التدريس", value: coverage.summary.totalGroups },
        {
          label: "مجدولة",
          value: coverage.summary.scheduledGroups,
          tone: "success" as const,
        },
        {
          label: "غير مجدولة",
          value: coverage.summary.unscheduledGroups,
          tone: coverage.summary.unscheduledGroups > 0 ? ("danger" as const) : ("success" as const),
        },
        { label: "ساعات مطلوبة", value: coverage.summary.requiredHours },
        { label: "ساعات مجدولة", value: coverage.summary.scheduledHours },
      ]}
      leading={
        isLoading || error ? null : (
          <DeliveryGroupCoverageCard summary={coverage.summary} unscheduled={unscheduledInView} />
        )
      }
      emptyMessage={
        error ? "تعذّر تحميل بيانات التقرير. أعد المحاولة." : "لا توجد محاضرات بهذه المعايير."
      }
      printContent={
        <ProgramTimetablePrint
          context={ctx}
          collegeName={active?.name}
          references={references}
          sessions={isLoading ? [] : raw}
          labels={labels}
          qrUrl={qrUrl}
          coverage={
            isLoading || error ? null : (
              <DeliveryGroupCoverageCard
                summary={coverage.summary}
                unscheduled={unscheduledInView}
              />
            )
          }
        />
      }
      filters={
        <ReportFilters
          context={ctx}
          extraSummary={academicSummary ? academicSummary.split(" · ") : undefined}
          advanced={filters.slice(3).map(({ field, label, items }) => (
            <ReportFilterField key={field} label={label} htmlFor={`plt-${field}`}>
              <Select
                value={view.selected[field]}
                onValueChange={(value) => change(field, value)}
                disabled={isLoading || !!error || !items.length}
              >
                <SelectTrigger id={`plt-${field}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ReportFilterField>
          ))}
        >
          {filters.slice(0, 3).map(({ field, label, items }) => (
            <ReportFilterField key={field} label={label} htmlFor={`plt-${field}`}>
              <Select
                value={view.selected[field]}
                onValueChange={(value) => change(field, value)}
                disabled={isLoading || !!error || !items.length}
              >
                <SelectTrigger id={`plt-${field}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ReportFilterField>
          ))}
        </ReportFilters>
      }
    >
      {sessions.length > 0 ? (
        <ReportTimetableView
          sessions={sessions}
          collegeId={ctx.collegeId}
          headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
        />
      ) : selectedCoverageRow && !selectedCoverageRow.scheduled ? (
        <Card className="p-6 text-sm" data-testid="unscheduled-group-empty-state">
          <p className="font-semibold">هذه المجموعة لم تُسكن في نسخة الجدول الحالية</p>
          <p className="mt-2 text-muted-foreground">
            {[
              [selectedCoverageRow.courseCode, selectedCoverageRow.courseName]
                .filter(Boolean)
                .join(" "),
              componentTypeLabel(selectedCoverageRow.componentType),
              selectedCoverageRow.groupCode ?? "",
              `الطلاب: ${selectedCoverageRow.expectedStudents ?? "—"}`,
              `الساعات المطلوبة: ${selectedCoverageRow.requiredHours}`,
              `المحاضر: ${selectedCoverageRow.instructorName ?? "غير مسند"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Card>
      ) : null}
    </ReportShell>
  );
}
