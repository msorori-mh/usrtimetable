import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
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
import { supabase } from "@/integrations/supabase/client";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import {
  ROOMS_REPORT_SUMMARY_HEADERS,
  ROOMS_REPORT_TITLE_AR,
  buildRoomsReportSummary,
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
    queryFn: async () => {
      const [rooms, roomTypes, availability, settings] = await Promise.all([
        supabase
          .from("rooms")
          .select("id, code, name, capacity, room_type_id, is_active")
          .eq("college_id", ctx.collegeId!)
          .order("code"),
        supabase
          .from("room_types")
          .select("id, name_ar, name_en, code")
          .eq("college_id", ctx.collegeId!),
        supabase
          .from("room_availability")
          .select("room_id, start_time, end_time")
          .eq("college_id", ctx.collegeId!),
        supabase
          .from("scheduling_settings")
          .select("working_days, day_start_time, day_end_time")
          .eq("college_id", ctx.collegeId!)
          .maybeSingle(),
      ]);
      const err =
        rooms.error || roomTypes.error || availability.error || settings.error
          ? (rooms.error ?? roomTypes.error ?? availability.error ?? settings.error)
          : null;
      if (err) throw err;
      return {
        rooms: rooms.data ?? [],
        roomTypes: roomTypes.data ?? [],
        availability: availability.data ?? [],
        settings: settings.data ?? null,
      };
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ["rooms-report-sessions", ctx.collegeId, ctx.versionId],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: async () => {
      const hydrated = await fetchHydratedVersionSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId!,
        studySystem: "all",
      });
      const sessions = hydrated as unknown as PrintSessionLike[];
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
  const pages = useMemo(
    () => groupRoomsReportPages(sessions, ctx.collegeId ?? ""),
    [sessions, ctx.collegeId],
  );

  const isLoading = ctx.isLoading || inventory.isLoading || sessionsQuery.isLoading;
  const ready = !!ctx.versionId;

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
        { label: "القاعات والمعامل", value: totals.rooms },
        { label: "الساعات المستخدمة", value: totals.usedHours, tone: "accent" },
        { label: "الساعات المتاحة", value: totals.availableHours },
        { label: "نسبة الاستغلال", value: `${totals.utilization}%`, tone: "accent" },
      ]}
      filters={<ReportFilters context={ctx} />}
      summary={
        <Card className="p-3 text-sm" data-testid="rooms-report-totals">
          <p className="font-semibold">
            الجلسات في النسخة: {totals.sessions} · صفحات القاعات: {pages.length}
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
            <h2 className="mb-2 text-base font-bold">ملخص القاعات والمعامل</h2>
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
                pageIndex: i + 2,
                pageCount: pages.length + 1,
              }}
            />
          ))}
        </>
      }
    >
      <div className="min-w-0 overflow-x-auto">
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
      </div>
    </ReportShell>
  );
}
