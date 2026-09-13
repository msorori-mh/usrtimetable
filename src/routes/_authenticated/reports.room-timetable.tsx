import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export const Route = createFileRoute("/_authenticated/reports/room-timetable")({
  head: () => ({ meta: [{ title: "تقرير جدول القاعة" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({ defaultStatusMode: "specific_version", defaultStudySystem: "all" });
  const [roomId, setRoomId] = useState("");

  const { data: rooms } = useQuery({
    queryKey: ["rt-rooms", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, code, name")
          .eq("college_id", ctx.collegeId!)
          .order("code")
      ).data ?? [],
  });

  const { data: sessionsBundle, isLoading: sessionsLoading } = useQuery({
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

  return (
    <ReportShell
      title="تقرير جدول القاعة"
      description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع.`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="room_timetable"
      rows={rows}
      headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      emptyMessage={!ready ? "اختر نسخة جدول وقاعة." : "لا توجد محاضرات."}
      filters={
        <ReportFilters context={ctx}>
          <div>
            <label className="text-xs text-muted-foreground">القاعة</label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر القاعة" />
              </SelectTrigger>
              <SelectContent>
                {(rooms ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.code ? `${r.code} — ${r.name}` : r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <ReportTimetableView sessions={sessions} collegeId={ctx.collegeId} headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS} />
      )}
    </ReportShell>
  );
}
