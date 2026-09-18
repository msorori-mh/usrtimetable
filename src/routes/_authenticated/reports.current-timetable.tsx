import { expandIntakeTimetable } from '@/lib/existing-schedules/presentation';
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
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

const EMPTY_SESSIONS: PrintSessionLike[] = [];

const DESCRIPTION =
  "طباعة النسخة الحالية من الجدول كاملة — مجمعة حسب البرنامج/المستوى/النظام مع مجموعات الطلاب، برأس رسمي وبدون أي تعديل على الجدول.";

export const Route = createFileRoute("/_authenticated/reports/current-timetable")({
  head: () => ({
    meta: [
      { title: `${CURRENT_SCHEDULE_TITLE_AR} — جامعة إقليم سبأ` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `${CURRENT_SCHEDULE_TITLE_AR} — جامعة إقليم سبأ` },
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
        studySystem: ctx.studySystem,
      });
      const sessions = expandIntakeTimetable(hydrated) as unknown as PrintSessionLike[];
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

  const sessions = bundle?.sessions ?? EMPTY_SESSIONS;
  const pages = useMemo(
    () =>
      groupCurrentSchedulePages(sessions, {
        collegeId: ctx.collegeId ?? "",
        studySystem: ctx.studySystem,
      }),
    [sessions, ctx.collegeId, ctx.studySystem],
  );
  const rows = useMemo(() => buildExportRows(pages, bundle?.labels), [pages, bundle?.labels]);
  const printedSessions = countPagedSessions(pages);
  const dropped = sessions.length - printedSessions;

  const cov = coverage.data;
  const groupsText = cov ? `${cov.groupsWithSessions}/${cov.totalGroups}` : "—";
  const hoursText = cov ? `${cov.scheduledHours}/${cov.requiredHours}` : "—";

  const isLoading = ctx.isLoading || sessionsLoading;
  const ready = !!ctx.versionId;
  const filtered = ctx.studySystem !== "all";
  const coverageSuffix = filtered ? " (كل الأنظمة)" : "";
  const scopeSuffix = filtered ? " (ضمن الفلتر)" : "";

  return (
    <ReportShell
      title={CURRENT_SCHEDULE_TITLE_AR}
      description={DESCRIPTION}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="current_timetable"
      rows={rows as unknown as Record<string, unknown>[]}
      headers={PRINT_EXPORT_HEADERS.map((h) => ({ key: h.key, label: h.label }))}
      isLoading={isLoading}
      error={ctx.error ?? sessionsError}
      onRetry={() => void refetch()}
      notReadyMessage={ready ? undefined : "اختر نسخة الجدول لطباعتها."}
      emptyMessage="لا توجد جلسات في هذه النسخة."
      kpis={[
        { label: `المجموعات المجدولة${coverageSuffix}`, value: groupsText, tone: "accent" },
        { label: `الساعات المجدولة${coverageSuffix}`, value: hoursText, tone: "accent" },
        { label: `الجلسات${scopeSuffix}`, value: sessions.length },
        { label: `صفحات الطباعة${scopeSuffix}`, value: pages.length },
      ]}
      filters={<ReportFilters context={ctx} />}
      summary={
        <Card className="p-3 text-sm" data-testid="current-timetable-coverage">
          <p className="font-semibold">
            التغطية الحالية (كل الأنظمة): المجموعات {groupsText} · الساعات {hoursText}
          </p>
          {filtered && (
            <p className="mt-1 text-muted-foreground">
              أرقام التغطية أعلاه محسوبة من قاعدة البيانات لكل الأنظمة، أما الجلسات والصفحات
              المعروضة فهي ضمن فلتر «نظام الدراسة» المختار فقط.
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
          <style>{printPageStyleCss("A3", "landscape")}</style>
          {pages.map((page, i) => (
            <PrintSheet
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
                isDemo: isDeliveryDemoVersion({ name: ctx.selectedVersion?.name }),
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

