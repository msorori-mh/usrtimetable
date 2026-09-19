import { supabase } from "@/integrations/supabase/client";
import { fetchStudentPrintMemberships } from "@/lib/print-center/student-memberships-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterField, ReportFilters } from "@/components/reports/report-filters";
import { Card } from "@/components/ui/card";
import { PrintSheet } from "@/components/print-center/print-sheet";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { useActiveCollege } from "@/hooks/use-colleges";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import { fetchDeliveryCoverage } from "@/lib/schedule-versions/delivery-coverage";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import {
  CURRENT_SCHEDULE_TITLE_AR,
  countPagedSessions,
  groupCurrentSchedulePages,
} from "@/lib/print-center/current-schedule";
import {
  DEFAULT_PRINT_VISIBILITY,
  PRINT_EXPORT_HEADERS,
  buildExportRows,
  latestSessionUpdate,
  printPageStyleCss,
  type PrintSessionLike,
} from "@/lib/print-center";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { filterCurrentScheduleScope } from "@/lib/print-center/current-schedule-scope";

const EMPTY_SESSIONS: PrintSessionLike[] = [];

const DESCRIPTION =
  "طباعة الجدول كاملًا أو حسب القسم والبرنامج والمستوى — مجمعة حسب البرنامج/المستوى/النظام مع مجموعات الطلاب، برأس رسمي وبدون أي تعديل على الجدول.";

export const Route = createFileRoute("/_authenticated/reports/current-timetable")({
  head: () => ({
    meta: [
      { title: `${CURRENT_SCHEDULE_TITLE_AR} — جامعة إقليم سبأ` },
      { name: "description", content: DESCRIPTION },
      {
        property: "og:title",
        content: `${CURRENT_SCHEDULE_TITLE_AR} — جامعة إقليم سبأ`,
      },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const { active } = useActiveCollege();
  const [departmentId, setDepartmentId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [levelId, setLevelId] = useState("all");
  const [scopeCollege, setScopeCollege] = useState(ctx.collegeId);
  if (scopeCollege !== ctx.collegeId) {
    setScopeCollege(ctx.collegeId);
    setDepartmentId("all");
    setProgramId("all");
    setLevelId("all");
  }
  const {
    data: catalog,
    isLoading: catalogLoading,
    error: catalogError,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ["current-timetable-scope", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () => {
      const [departments, programs, levels] = await Promise.all([
        supabase
          .from("departments")
          .select("id,name")
          .eq("college_id", ctx.collegeId!)
          .order("name"),
        supabase
          .from("academic_programs")
          .select("id,name,department_id")
          .eq("college_id", ctx.collegeId!)
          .order("name"),
        supabase
          .from("academic_levels")
          .select("id,name,level_number,program_id")
          .eq("college_id", ctx.collegeId!)
          .order("level_number")
          .order("name"),
      ]);
      if (departments.error) throw departments.error;
      if (programs.error) throw programs.error;
      if (levels.error) throw levels.error;
      return {
        departments: departments.data ?? [],
        programs: programs.data ?? [],
        levels: levels.data ?? [],
      };
    },
  });
  const availablePrograms = (catalog?.programs ?? []).filter(
    (p) => departmentId === "all" || p.department_id === departmentId,
  );
  const availableLevels = (catalog?.levels ?? []).filter(
    (level) => programId !== "all" && level.program_id === programId,
  );
  const selectedDepartment = catalog?.departments.find((d) => d.id === departmentId);
  const selectedProgram = availablePrograms.find((p) => p.id === programId);
  const selectedLevel = availableLevels.find((level) => level.id === levelId);
  const extraSummary = [
    ...(departmentId !== "all" ? [`القسم: ${selectedDepartment?.name ?? departmentId}`] : []),
    ...(programId !== "all" ? [`البرنامج: ${selectedProgram?.name ?? programId}`] : []),
    ...(levelId !== "all" ? [`المستوى: ${selectedLevel?.name ?? levelId}`] : []),
  ];
  const exportAt = useMemo(() => new Date(), []);
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => setQrUrl(window.location.href), []);

  const {
    data: bundle,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch,
  } = useQuery({
    queryKey: ["current-timetable-print", ctx.collegeId, ctx.versionId, ctx.studySystem],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: async () => {
      const hydrated = await fetchHydratedVersionSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId!,
        studySystem: "all",
      });
      const expanded = (await fetchStudentPrintMemberships(hydrated, ctx.collegeId!)).filter(
        (row) =>
          ctx.studySystem === "all" ||
          row.study_system === "both" ||
          row.study_system === ctx.studySystem,
      );
      const planIds = [
        ...new Set(
          expanded.flatMap((r) => r.intake_memberships?.map((m) => m.study_plan_id) ?? []),
        ),
      ];
      const plans = planIds.length
        ? await supabase
            .from("study_plans")
            .select("id,name")
            .eq("college_id", ctx.collegeId!)
            .in("id", planIds)
        : { data: [], error: null };
      if (plans.error) throw plans.error;
      const sessions: PrintSessionLike[] = expanded.map((row) => {
        const membership = row.intake_memberships?.find(
          (m) => m.delivery_group_id === row.delivery_group_id && m.cohort_id === row.cohort_id,
        );
        if (!membership) return row;
        const plan = plans.data?.find((p) => p.id === membership.study_plan_id);
        return {
          ...row,
          intake_study_plan_id: membership.study_plan_id,
          course_offerings: {
            ...row.course_offerings,
            academic_programs: {
              name: plan?.name ?? row.course_offerings?.academic_programs?.name,
            },
          },
        };
      });
      const labels = await fetchCohortDeliveryGroupLabels(ctx.collegeId!, sessions);
      return { sessions, labels };
    },
  });

  const coverage = useQuery({
    queryKey: ["current-timetable-coverage", ctx.collegeId, ctx.versionId],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: () =>
      fetchDeliveryCoverage({
        collegeId: ctx.collegeId!,
        scheduleVersionId: ctx.versionId!,
      }),
  });

  const sessions = useMemo(
    () =>
      filterCurrentScheduleScope(
        bundle?.sessions ?? EMPTY_SESSIONS,
        catalog?.programs ?? [],
        departmentId,
        programId,
        levelId,
      ),
    [bundle?.sessions, catalog?.programs, departmentId, programId, levelId],
  );
  const pages = useMemo(
    () =>
      groupCurrentSchedulePages(sessions, {
        collegeId: ctx.collegeId ?? "",
        studySystem: ctx.studySystem,
      }).map((page) => {
        const program = catalog?.programs.find(
          (p) => p.id === page.sessions[0]?.course_offerings?.program_id,
        );
        return {
          ...page,
          departmentName: catalog?.departments.find((d) => d.id === program?.department_id)?.name,
        };
      }),
    [sessions, ctx.collegeId, ctx.studySystem, catalog],
  );
  const rows = useMemo(() => buildExportRows(pages, bundle?.labels), [pages, bundle?.labels]);
  const printedSessions = countPagedSessions(pages);
  const dropped = sessions.length - printedSessions;

  const cov = coverage.data;
  const groupsText = cov ? `${cov.groupsWithSessions}/${cov.totalGroups}` : "—";
  const hoursText = cov ? `${cov.scheduledHours}/${cov.requiredHours}` : "—";

  const isLoading = ctx.isLoading || sessionsLoading || catalogLoading;
  const ready = !!ctx.versionId;
  const filtered =
    ctx.studySystem !== "all" || departmentId !== "all" || programId !== "all" || levelId !== "all";
  const coverageSuffix = filtered ? " (الكلية كاملة)" : "";
  const scopeSuffix = filtered ? " (ضمن الفلتر)" : "";

  return (
    <ReportShell
      title={CURRENT_SCHEDULE_TITLE_AR}
      description={DESCRIPTION}
      filterSummary={[ctx.filterSummary, ...extraSummary].join(" · ")}
      reportContext={ctx}
      filename="current_timetable"
      rows={rows as unknown as Record<string, unknown>[]}
      headers={PRINT_EXPORT_HEADERS.map((h) => ({
        key: h.key,
        label: h.label,
      }))}
      isLoading={isLoading}
      error={ctx.error ?? sessionsError ?? catalogError}
      onRetry={() => {
        void refetch();
        void refetchCatalog();
      }}
      notReadyMessage={ready ? undefined : "اختر نسخة الجدول لطباعتها."}
      emptyMessage="لا توجد جلسات تطابق القسم والبرنامج والمستوى ونظام الدراسة المحدد في هذه النسخة."
      kpis={[
        {
          label: `المجموعات المجدولة${coverageSuffix}`,
          value: groupsText,
          tone: "accent",
        },
        {
          label: `الساعات المجدولة${coverageSuffix}`,
          value: hoursText,
          tone: "accent",
        },
        { label: `الجلسات${scopeSuffix}`, value: sessions.length },
        { label: `صفحات الطباعة${scopeSuffix}`, value: pages.length },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          extraSummary={extraSummary}
          onClear={() => {
            setDepartmentId("all");
            setProgramId("all");
            setLevelId("all");
          }}
        >
          <ReportFilterField label="القسم" htmlFor="current-print-department">
            <Select
              value={departmentId}
              disabled={catalogLoading || !!catalogError}
              onValueChange={(value) => {
                setDepartmentId(value);
                setProgramId("all");
                setLevelId("all");
              }}
            >
              <SelectTrigger id="current-print-department" aria-label="القسم">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأقسام</SelectItem>
                {(catalog?.departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
          <ReportFilterField label="البرنامج" htmlFor="current-print-program">
            <Select
              value={programId}
              onValueChange={(value) => {
                setProgramId(value);
                setLevelId("all");
              }}
              disabled={catalogLoading || !!catalogError}
            >
              <SelectTrigger id="current-print-program" aria-label="البرنامج">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع البرامج</SelectItem>
                {availablePrograms.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
          <ReportFilterField label="المستوى" htmlFor="current-print-level">
            <Select
              value={levelId}
              onValueChange={setLevelId}
              disabled={catalogLoading || !!catalogError || programId === "all"}
            >
              <SelectTrigger id="current-print-level" aria-label="المستوى">
                <SelectValue
                  placeholder={programId === "all" ? "اختر البرنامج أولًا" : "اختر المستوى"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع مستويات البرنامج</SelectItem>
                {availableLevels.map((level) => (
                  <SelectItem key={level.id} value={level.id}>
                    {level.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
        </ReportFilters>
      }
      summary={
        <Card className="p-3 text-sm" data-testid="current-timetable-coverage">
          <p className="font-semibold">
            التغطية الحالية (الكلية كاملة، كل الأنظمة): المجموعات {groupsText} · الساعات {hoursText}
          </p>
          {filtered && (
            <p className="mt-1 text-muted-foreground">
              أرقام التغطية أعلاه تخص الكلية كاملة بجميع الأنظمة؛ أما الجلسات والصفحات والطباعة
              والتصدير فتتبع القسم والبرنامج والمستوى ونظام الدراسة المختارة.
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            {dropped === 0
              ? `تُطبع جميع الجلسات ضمن الفلتر الحالي (${printedSessions} جلسة) بدون حذف.`
              : `تنبيه: ${dropped} جلسة لم تُدرج في الصفحات — راجع البيانات قبل الطباعة.`}
          </p>
        </Card>
      }
      printContent={
        <>
          <style>{printPageStyleCss("A4", "portrait")}</style>
          {pages.map((page, i) => (
            <PrintSheet
              readable
              key={page.key}
              page={page}
              labels={bundle?.labels}
              visibility={DEFAULT_PRINT_VISIBILITY}
              meta={{
                collegeName: active?.name,
                departmentName: page.departmentName,
                programName: page.programName,
                levelName: page.levelName,
                studySystem: page.studySystem,
                termName: ctx.terms.find((t) => t.id === ctx.termId)?.name,
                versionName: ctx.selectedVersion?.name,
                versionStatus: ctx.selectedVersion?.status,
                versionNumber: ctx.selectedVersion?.name,
                exportAt,
                lastUpdate: latestSessionUpdate(sessions),
                qrUrl,
                isDemo: isDeliveryDemoVersion({
                  name: ctx.selectedVersion?.name,
                }),
                pageIndex: i + 1,
                pageCount: pages.length,
              }}
            />
          ))}
        </>
      }
    >
      <div className="space-y-6">
        {pages.map((page) => (
          <section key={page.key} className="space-y-2">
            <h2 className="text-base font-semibold">{page.title}</h2>
            <p className="text-xs text-muted-foreground">{page.sessions.length} جلسة</p>
          </section>
        ))}
      </div>
    </ReportShell>
  );
}
