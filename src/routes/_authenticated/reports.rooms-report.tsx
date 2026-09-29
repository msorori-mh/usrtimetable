import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoomsExecutiveSummary } from "@/components/reports/rooms-executive-summary";
import { roomsExecutiveSummary } from "@/lib/reports/rooms-executive";
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
  "ملخص القاعات والمعامل يفصل ساعات الجدول عن الإشغال داخل الإتاحة المعتمدة والساعات الواقعة خارجها، ثم يعرض تفاصيل كل مورد — قراءة فقط وقابل للطباعة/PDF.";

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
  const [pageUrl, setPageUrl] = useState("");
  useEffect(() => setPageUrl(window.location.href), []);
  const qrUrl = useMemo(() => {
    if (!pageUrl) return "";
    const url = new URL(pageUrl);
    for (const [key, value] of Object.entries({
      collegeId: ctx.collegeId,
      termId: ctx.termId,
      versionId: ctx.versionId,
      statusMode: ctx.statusMode,
      studySystem: ctx.studySystem,
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    return url.toString();
  }, [pageUrl, ctx.collegeId, ctx.termId, ctx.versionId, ctx.statusMode, ctx.studySystem]);

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
            unavailability: inventory.data.unavailability,
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
        rooms: inventory.data?.rooms ?? [],
        sessions,
        availability: inventory.data?.availability ?? [],
        unavailability: inventory.data?.unavailability ?? [],
        settings: inventory.data?.settings,
      }),
    [summary, sessions, inventory.data],
  );
  const pages = useMemo(
    () => groupRoomsReportPages(sessions, ctx.collegeId ?? ""),
    [sessions, ctx.collegeId],
  );

  const executive = useMemo(() => roomsExecutiveSummary(summary, sessions), [summary, sessions]);
  const [view, setView] = useState("overview");

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
        {
          label: `المجدول في نسخة الكلية${scopeSuffix}`,
          value: totals.scheduledHours,
          hint: "يشمل ما يقع خارج إتاحة المورد",
        },
        {
          label: `المستخدم داخل الإتاحة${scopeSuffix}`,
          value: totals.usedHours,
          hint:
            executive.utilization === null
              ? "النسبة غير قابلة للحساب"
              : `استغلال الإتاحة ${executive.utilization}%`,
          tone: "accent",
        },
        {
          label: "الإتاحة المعتمدة",
          value: executive.complete ? totals.availableHours : "غير مكتملة",
        },
        {
          label: "غير المشغول داخل الإتاحة",
          value: executive.complete ? totals.freeHours : "غير محسوبة",
        },
        {
          label: "خارج الإتاحة",
          value: totals.outsideHours,
          hint: "مخالفة مستقلة لا ترفع نسبة الاستغلال",
          tone: totals.outsideHours > 0 ? "danger" : "success",
        },
      ]}
      filters={<ReportFilters context={ctx} />}
      printContent={
        <>
          <style>{printPageStyleCss()}</style>
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
                هذا التقرير يحسب نسخة جدول الكلية المحددة فقط. لوحة رئيس الجامعة تجمع أيضًا إشغال
                الموارد المستضافة من نسخ الكليات الأخرى؛ لذلك قد يختلف إشغال المورد بين النطاقين.
              </p>
              <RoomsExecutiveSummary result={executive} />
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
                  <b>المجدول / داخل الإتاحة</b>
                  <br />
                  {totals.scheduledHours} / {totals.usedHours} ساعة
                </div>
                <div className="border p-2">
                  <b>المتاح / غير المشغول</b>
                  <br />
                  {executive.complete ? `${totals.availableHours} / ${totals.freeHours} ساعة` : "—"}
                </div>
                <div className="border p-2">
                  <b>متوسط القاعات</b>
                  <br />
                  {executive.complete && analytics.halls > 0
                    ? `${analytics.hallAverageUtilization}%`
                    : "—"}
                </div>
                <div className="border p-2">
                  <b>متوسط المعامل</b>
                  <br />
                  {executive.complete && analytics.labs > 0
                    ? `${analytics.labAverageUtilization}%`
                    : "—"}
                </div>
                <div className="border p-2">
                  <b>مزدحم / متوسط / منخفض</b>
                  <br />
                  {executive.complete
                    ? `${analytics.bands.crowded} / ${analytics.bands.medium} / ${analytics.bands.low}`
                    : "غير قابل للتصنيف"}
                </div>
                <div className="border p-2">
                  <b>أعلى / أقل استخدامًا</b>
                  <br />
                  {executive.complete
                    ? `${analytics.highest?.room_name ?? "—"} / ${analytics.lowest?.room_name ?? "—"}`
                    : "—"}
                </div>
              </div>
              {totals.outsideHours > 0 && (
                <p className="mb-3 border border-destructive p-2 font-semibold text-destructive">
                  خارج الإتاحة المعتمدة: {totals.outsideHours} ساعة مجدولة. تظهر كمخالفة مستقلة ولا
                  تدخل في بسط نسبة استغلال الوقت المتاح.
                </p>
              )}
              <h3 className="mb-2 font-bold">ترتيب استغلال الوقت</h3>
              <div
                className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs"
                data-testid="rooms-print-chart"
              >
                {[...summary]
                  .filter((row) => row.available_hours > 0)
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
                    <TableHead>المورد</TableHead>
                    <TableHead>استخدام الوقت</TableHead>
                    <TableHead>استغلال السعة</TableHead>
                    <TableHead>الجلسات</TableHead>
                    <TableHead>الذروة</TableHead>
                    <TableHead>مؤشر القرار</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((r) => {
                    const decision =
                      r.outside_hours > 0
                        ? `خارج الإتاحة ${r.outside_hours} س`
                        : r.utilization_percent >= 90
                          ? "ضغط مرتفع"
                          : r.utilization_percent >= 80
                            ? "استخدام مرتفع"
                            : r.utilization_percent <= 50
                              ? "فرصة لإعادة التوزيع"
                              : "استخدام متوازن";
                    const capacityNote =
                      r.utilization_percent >= 80 && r.capacity_efficiency_percent < 60
                        ? " · راجع ملاءمة السعة"
                        : "";
                    return (
                      <TableRow key={`${r.room_code}-${r.room_name}`}>
                        <TableCell>
                          <div className="font-semibold">{r.room_name}</div>
                          <div className="text-[8pt]">
                            {r.room_code || "—"} · {r.room_type} · السعة {r.capacity}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            مجدول <b>{r.scheduled_hours} س</b> · داخل الإتاحة{" "}
                            <b>{r.used_hours} س</b>
                          </div>
                          <div className="text-[8pt]">
                            متاح <b>{r.available_hours > 0 ? `${r.available_hours} س` : "—"}</b>
                            {" · "}غير مشغول داخل الإتاحة{" "}
                            {r.available_hours > 0 ? `${r.free_hours} س` : "—"} · الاستغلال{" "}
                            <b>{r.utilization}</b>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            متوسط الطلاب <b>{r.average_students}</b> / {r.capacity}
                          </div>
                          <div className="text-[8pt]">
                            كفاءة المقاعد {r.capacity_efficiency_percent}% · الأعلى {r.max_students}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            الإجمالي <b>{r.session_count}</b>
                          </div>
                          <div className="text-[8pt]">
                            نظري {r.theory_sessions} · عملي/أخرى {r.applied_sessions}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{r.peak_day}</div>
                          <div className="text-[8pt]">{r.peak_slot}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold">
                            {decision}
                            {capacityNote}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
      <Tabs value={view} onValueChange={setView} className="report-no-print">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">الخلاصة</TabsTrigger>
          <TabsTrigger value="analytics">التحليل والتفاصيل</TabsTrigger>
          <TabsTrigger value="operations">إشغال القاعات وفرص التحسين</TabsTrigger>
          <TabsTrigger value="comparison">المقارنات</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="space-y-3">
            <RoomsExecutiveSummary result={executive} />
            <Card className="p-3 text-sm" data-testid="rooms-report-totals">
              {sessionsQuery.isPlaceholderData && (
                <p role="status">جارٍ تحديث البيانات حسب نظام الدراسة؛ الأرقام السابقة مؤقتة.</p>
              )}
              <p className="font-semibold">
                الجلسات المطابقة للفلاتر: {totals.sessions} · صفحات القاعات: {pages.length}
              </p>
              <RoomsCategorySummary summary={summary} />
              <p className="mt-2 text-muted-foreground">
                «المجدول» هو مجموع ساعات جلسات نسخة الكلية، أما «المستخدم» فهو اتحاد الإشغال داخل
                الإتاحة المعتمدة فقط. الساعات خارج الإتاحة تظهر مستقلة ولا ترفع نسبة الاستغلال. عند
                اختيار نظام واحد، قد تشغل النظام الآخر بعض الوقت الظاهر غير مشغول. لوحة رئيس الجامعة
                تشمل كذلك إشغال الموارد المستضافة من نسخ كليات أخرى.
              </p>
              {totals.sessionsWithoutRoom > 0 && (
                <p className="mt-1 text-muted-foreground">
                  جلسات بدون قاعة محددة: {totals.sessionsWithoutRoom} — تظهر في صفحة «قاعة غير
                  محددة».
                </p>
              )}
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="analytics">
          {executive.complete ? (
            <RoomsAnalyticsDashboard summary={summary} analytics={analytics} />
          ) : (
            <Card className="p-5 text-sm leading-7">
              لا يمكن ترتيب كفاءة الاستخدام قبل استكمال بيانات الإتاحة. الساعات المسجلة موضحة في
              الخلاصة، ويمكن مراجعة محاضرات كل قاعة في تبويب الإشغال.
            </Card>
          )}
        </TabsContent>
        <TabsContent value="operations">
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
        </TabsContent>
        <TabsContent value="comparison">
          {ctx.collegeId && (
            <RoomsComparison
              key={ctx.collegeId}
              collegeId={ctx.collegeId}
              studySystem={ctx.studySystem}
              currentLabel={`${active?.name ?? ""} · ${ctx.filterSummary}`}
              totals={totals}
            />
          )}
        </TabsContent>
      </Tabs>
    </ReportShell>
  );
}
