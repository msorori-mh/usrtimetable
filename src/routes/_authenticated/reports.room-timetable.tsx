import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters, ReportFilterField } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
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
  fetchRoomTimetableSessions,
} from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/reports/room-timetable")({
  head: () => ({ meta: [{ title: "تقرير جدول القاعة" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [roomId, setRoomId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("roomId") ?? ""),
  );

  const { data: rooms, error: roomsError } = useQuery({
    queryKey: ["rt-rooms", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, code, name")
        .eq("college_id", ctx.collegeId!)
        .order("code")
        .throwOnError();
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: sessionsBundle,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch,
  } = useQuery({
    queryKey: ["rt-sess", ctx.collegeId, ctx.versionId, ctx.studySystem, roomId],
    enabled: !!ctx.collegeId && !!ctx.versionId && !!roomId,
    queryFn: async () => {
      const raw = await fetchRoomTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        roomId,
        studySystem: ctx.studySystem,
      });
      // A1.5: resolve New Flow cohort/DG labels for display + export.
      const labels = await fetchCohortDeliveryGroupLabels(ctx.collegeId!, raw);
      return { raw, labels };
    },
  });

  const sessions = useMemo(
    () => mapRawSessions(sessionsBundle?.raw ?? [], sessionsBundle?.labels),
    [sessionsBundle],
  );
  const rows = useMemo(() => timetableSessionsToRows(sessions), [sessions]);
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);

  const isLoading = ctx.isLoading || sessionsLoading;
  const ready = !!ctx.versionId && !!roomId;
  const room = (rooms ?? []).find((r) => r.id === roomId);
  const roomLabel = room ? entityDisplayName(room) : undefined;

  return (
    <ReportShell
      title={roomLabel ? `الجدول الأسبوعي — ${roomLabel}` : "تقرير جدول القاعة"}
      description="الاستخدام الأسبوعي لقاعة أو معمل واحد داخل نسخة جدول واحدة."
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      shareParams={{ roomId }}
      filename="room_timetable"
      rows={rows}
      headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      error={ctx.error ?? roomsError ?? sessionsError}
      onRetry={() => void refetch()}
      notReadyMessage={ready ? undefined : "اختر نسخة جدول وقاعة لعرض الجدول."}
      emptyMessage="لا توجد محاضرات في هذه القاعة ضمن النسخة المحددة."
      kpis={[
        { label: "المحاضرات", value: rows.length },
        { label: "ساعات/أسبوع", value: totalHours.toFixed(2), tone: "accent" },
        { label: "أيام الاستخدام", value: new Set(rows.map((r) => String(r.day))).size },
        { label: "المقررات", value: new Set(rows.map((r) => String(r.course))).size },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          extraSummary={roomLabel ? [`القاعة: ${roomLabel}`] : []}
          onClear={() => setRoomId("")}
        >
          <ReportFilterField label="القاعة" htmlFor="rt-room">
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger id="rt-room" aria-label="القاعة">
                <SelectValue placeholder="اختر القاعة" />
              </SelectTrigger>
              <SelectContent>
                {(rooms ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {entityDisplayName(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <ReportTimetableView
          sessions={sessions}
          collegeId={ctx.collegeId}
          headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
        />
      )}
    </ReportShell>
  );
}
