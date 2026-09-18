import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
import {
  ReportOfficialHeader,
  headerMetaFromContext,
} from "@/components/reports/report-official-header";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { RoomsAnalyticsDashboard } from "@/components/reports/rooms-analytics-dashboard";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrintSheet } from "@/components/print-center/print-sheet";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { useActiveCollege } from "@/hooks/use-colleges";
import { fetchRoomsInventory } from "@/lib/reports/queries/rooms-inventory";
import { RoomsDecisionsPanel } from "@/components/reports/rooms-decisions-panel";
import { RoomsComparison } from "@/components/reports/rooms-comparison";
import { RoomsCategorySummary } from "@/components/reports/rooms-category-summary";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import {
  ROOMS_REPORT_SUMMARY_HEADERS,
  ROOMS_REPORT_TITLE_AR,
  buildRoomsReportSummary,
  buildRoomsReportAnalytics,
  groupRoomsReportPages,
  roomsReportTotals,
} from "@/lib/print-center/rooms-report";
import {
  DEFAULT_PRINT_VISIBILITY,
  latestSessionUpdate,
  printPageStyleCss,
  type PrintSessionLike,
} from "@/lib/print-center";

const EMPTY_SESSIONS: PrintSessionLike[] = [];

const DESCRIPTION =
  "ملخص كل القاعات والمعامل (النوع، السعة، الساعات المستخدمة والمتاحة، نسبة الاستغلال، عدد الجلسات) ثم جدول تفصيلي لكل قاعة — قراءة فقط وقابل للطباعة/PDF.";

export const Route = createFileRoute("/_authenticated/reports/rooms-report")({
  head: () => ({
    meta: [
      { title: `${ROOMS_REPORT_TITLE_AR} — جامعة إقليم سبأ` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `${ROOMS_REPORT_TITLE_AR} — جامعة إقليم سبأ` },
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

  const inventory = useQuery({
    queryKey: ["rooms-report-inventory", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: () => fetchRoomsInventory(ctx.collegeId!),
  });

  const sessionsQuery = useQuery({
    queryKey: ["rooms-report-sessions", ctx.collegeId, ctx.versionId, ctx.studySystem],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === ctx.collegeId && previousQuery?.queryKey[2] === ctx.versionId
        ? previous
        : undefined,
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: async () => {
      const hydrated = await fetchHydratedVersionSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId!,
        studySystem: ctx.studySystem,
      });
      const sessions = hydrated.filter(
        (s) => !s.replaced_by_split,
      ) as unknown as PrintSessionLike[];
      const labels = await fetchCohortDeliveryGroupLabels(ctx.collegeId!, sessions);
      return { sessions, labels };
    },
  });

  const sessions = sessionsQuery.data?.sessions ?? EMPTY_SESSIONS;
  const summary = useMemo(
    () =>
      inventory.data
        ? buildRoomsReportSummary({
            rooms: inventory.data.rooms,
            roomTypes: inventory.data.roomTypes,
            sessions,
            availability: inventory.data.availability,
            settings: inventory.data.settings,
          })
        : [],
    [inventory.data, sessions],
  );
  const totals = useMemo(() => roomsReportTotals({ summary, sessions }), [summary, sessions]);
  const analytics = useMemo(
    () =>
      buildRoomsReportAnalytics({
        summary,
        sessions,
        availability: inventory.data?.availability ?? [],
        settings: inventory.data?.settings,
      }),
    [summary, sessions, inventory.data],
  );
  const pages = useMemo(
    () => groupRoomsReportPages(sessions, ctx.collegeId ?? ""),
    [sessions, ctx.collegeId],
  );

  const isLoading = ctx.isLoading || inventory.isLoading || sessionsQuery.isLoading;
  const ready = !!ctx.versionId;
  const filtered = ctx.studySystem !== "all";
  const scopeSuffix = filtered ? " (ضمن الفلتر)" : "";

  return (
    <ReportShell
      title={ROOMS_REPORT_TITLE_AR}
      description={DESCRIPTION}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="rooms_report"
      rows={summary as unknown as Record<string, unknown>[]}
      headers={ROOMS_REPORT_SUMMARY_HEADERS.map((h) => ({ key: h.key, label: h.label }))}
      isLoading={isLoading}
      error={ctx.error ?? inventory.error ?? sessionsQuery.error}
      onRetry={() => {
        void inventory.refetch();
        void sessionsQuery.refetch();
      }}
      notReadyMessage={ready ? undefined : "اختر نسخة الجدول لعرض تقرير القاعات."}
      emptyMessage="لا توجد قاعات مسجلة في هذه الكلية."
      kpis={[
        { label: "إجمالي الموارد", value: totals.rooms },
        { label: `الساعات المستخدمة${scopeSuffix}`, value: totals.usedHours, tone: "accent" },
        { label: "الساعات المتاحة", value: totals.availableHours },
        { label: "غير مستخدمة في النطاق", value: totals.freeHours },
        { label: "نسبة الاستغلال", value: `${totals.utilization}%`, tone: "accent" },
      ]}
      filters={<ReportFilters context={ctx} />}
      summary={
        <Card className="p-3 text-sm" data-testid="rooms-report-totals">
          {sessionsQuery.isPlaceholderData && (
            <p role="status">جارٍ تحديث البيانات حسب نظام الدراسة؛ الأرقام السابقة مؤقتة.</p>
          )}
          <p className="font-semibold">
            الجلسات المطابقة للفلاتر: {totals.sessions} · صفحات القاعات: {pages.length}
          </p>
          <RoomsCategorySummary summary={summary} />
          <p className="mt-2 text-muted-foreground">
            الإتاحة هي ساعات فتح القاعات الكاملة. عند اختيار نظام واحد، تمثل النسبة حصته من هذه
            الإتاحة؛ الساعات غير المستخدمة ضمن الاختيار قد تشغلها محاضرات النظام الآخر.
          </p>
          {totals.sessionsWithoutRoom > 0 && (
            <p className="mt-1 text-muted-foreground">
              جلسات بدون قاعة محددة: {totals.sessionsWithoutRoom} — تظهر في صفحة «قاعة غير محددة».
            </p>
          )}
        </Card>
      }
      printContent={
        <>
          <style>{printPageStyleCss("A3", "landscape")}</style>
          <section className="print-center-page break-after-page">
            <RepeatingPrintHeader
              header={
                <ReportOfficialHeader
                  reportTitle="الملخص التنفيذي للقاعات والمعامل"
                  collegeName={active?.name}
                  {...headerMetaFromContext(ctx)}
                  generatedAt={exportAt}
                  qrUrl={qrUrl}
                />
              }
            >
              <h2 className="mb-2 text-base font-bold">الملخص التنفيذي للقاعات والمعامل</h2>
              <p className="mb-2 text-sm">{ctx.filterSummary}</p>
              <p className="mb-2 text-xs">
                الساعات غير المستخدمة محسوبة ضمن الفلاتر؛ راجع إشغال النظامين قبل إعادة التسكين.
              </p>
              <p className="mb-3 text-sm leading-6">{analytics.insight}</p>
              <RoomsCategorySummary summary={summary} />
              <div className="mb-4 grid grid-cols-4 gap-2 text-sm">
                <div className="border p-2">
                  <b>إجمالي الموارد</b>
                  <br />
                  {totals.rooms}
                </div>
                <div className="border p-2">
                  <b>القاعات / المعامل</b>
                  <br />
                  {analytics.halls} / {analytics.labs}
                </div>
                <div className="border p-2">
                  <b>المستخدم / الفارغ</b>
                  <br />
                  {totals.usedHours} / {totals.freeHours} ساعة
                </div>
                <div className="border p-2">
                  <b>الاستغلال العام</b>
                  <br />
                  {totals.utilization}%
                </div>
                <div className="border p-2">
                  <b>متوسط القاعات</b>
                  <br />
                  {analytics.hallAverageUtilization}%
                </div>
                <div className="border p-2">
                  <b>متوسط المعامل</b>
                  <br />
                  {analytics.labAverageUtilization}%
                </div>
                <div className="border p-2">
                  <b>مزدحم / متوسط / منخفض</b>
                  <br />
                  {analytics.bands.crowded} / {analytics.bands.medium} / {analytics.bands.low}
                </div>
                <div className="border p-2">
                  <b>أعلى / أقل استخدامًا</b>
                  <br />
                  {analytics.highest?.room_name ?? "—"} / {analytics.lowest?.room_name ?? "—"}
                </div>
              </div>
              {totals.overbookedHours > 0 && (
                <p className="mb-3 border border-destructive p-2 font-semibold text-destructive">
                  تجاوز الإتاحة المرصود: {totals.overbookedHours} ساعة. لم تُخفَ هذه الزيادة من
                  الحسابات.
                </p>
              )}
              <h3 className="mb-2 font-bold">ترتيب استغلال الوقت</h3>
              <div
                className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs"
                data-testid="rooms-print-chart"
              >
                {[...summary]
                  .sort((a, b) => b.utilization_percent - a.utilization_percent)
                  .map((row) => (
                    <div
                      key={row.room_id}
                      className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2"
                    >
                      <span className="truncate">{row.room_name}</span>
                      <span className="h-2 bg-muted">
                        <span
                          className="block h-full bg-primary"
                          style={{ width: `${Math.min(100, row.utilization_percent)}%` }}
                        />
                      </span>
                      <b>{row.utilization}</b>
                    </div>
                  ))}
              </div>
            </RepeatingPrintHeader>
          </section>
          <section className="print-center-page break-after-page">
            <RepeatingPrintHeader
              header={
                <ReportOfficialHeader
                  reportTitle="جدول ملخص القاعات والمعامل"
                  collegeName={active?.name}
                  {...headerMetaFromContext(ctx)}
                  generatedAt={exportAt}
                  qrUrl={qrUrl}
                />
              }
            >
              <h2 className="mb-2 text-base font-bold">جدول ملخص القاعات والمعامل</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    {ROOMS_REPORT_SUMMARY_HEADERS.map((h) => (
                      <TableHead key={h.key}>{h.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((r) => (
                    <TableRow key={`${r.room_code}-${r.room_name}`}>
                      {ROOMS_REPORT_SUMMARY_HEADERS.map((h) => (
                        <TableCell key={h.key}>{String(r[h.key])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </RepeatingPrintHeader>
          </section>
          {pages.map((page, i) => (
            <PrintSheet
              key={page.key}
              page={page}
              labels={sessionsQuery.data?.labels}
              visibility={DEFAULT_PRINT_VISIBILITY}
              meta={{
                collegeName: active?.name,
                termName: ctx.terms.find((t) => t.id === ctx.termId)?.name,
                versionName: ctx.selectedVersion?.name,
                versionStatus: ctx.selectedVersion?.status,
                versionNumber: ctx.selectedVersion?.name,
                exportAt,
                lastUpdate: latestSessionUpdate(sessions),
                qrUrl,
                isDemo: isDeliveryDemoVersion({ name: ctx.selectedVersion?.name }),
                pageIndex: i + 3,
                pageCount: pages.length + 2,
              }}
            />
          ))}
        </>
      }
    >
      <RoomsAnalyticsDashboard summary={summary} analytics={analytics} />
      {ctx.collegeId && ctx.versionId && inventory.data && (
        <RoomsDecisionsPanel
          key={`${ctx.collegeId}:${ctx.versionId}`}
          collegeId={ctx.collegeId}
          versionId={ctx.versionId}
          studySystem={ctx.studySystem}
          sessions={sessions}
          inventory={inventory.data}
        />
      )}
      {ctx.collegeId && (
        <RoomsComparison
          key={ctx.collegeId}
          collegeId={ctx.collegeId}
          studySystem={ctx.studySystem}
          currentLabel={`${active?.name ?? ""} · ${ctx.filterSummary}`}
          totals={totals}
        />
      )}
    </ReportShell>
  );
}
