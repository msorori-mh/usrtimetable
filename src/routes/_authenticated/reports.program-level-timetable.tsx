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
  TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import {
  fetchDeliveryGroupOptions,
  deliveryGroupLabelMap,
  fetchProgramLevelTimetableSessions,
} from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";

export const Route = createFileRoute("/_authenticated/reports/program-level-timetable")({
  head: () => ({ meta: [{ title: "تقرير جدول البرنامج/المستوى" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({ defaultStatusMode: "specific_version", defaultStudySystem: "all" });
  const [deptId, setDeptId] = useState("all");
  const [progId, setProgId] = useState("all");
  const [lvlId, setLvlId] = useState("all");
  const [groupId, setGroupId] = useState("all");

  const { data: depts } = useQuery({
    queryKey: ["plt-depts", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () =>
      (await supabase.from("departments").select("id, name").eq("college_id", ctx.collegeId!)).data ?? [],
  });

  const { data: progs } = useQuery({
    queryKey: ["plt-progs", ctx.collegeId, deptId],
    enabled: !!ctx.collegeId,
    queryFn: async () => {
      let q = supabase.from("academic_programs").select("id, name").eq("college_id", ctx.collegeId!);
      if (deptId !== "all") q = q.eq("department_id", deptId);
      return (await q.order("name")).data ?? [];
    },
  });

  const { data: levels } = useQuery({
    queryKey: ["plt-levels", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () =>
      (await supabase.from("academic_levels").select("id, name").eq("college_id", ctx.collegeId!)).data ?? [],
  });

  const { data: groupOptions } = useQuery({
    queryKey: ["plt-groups", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: () => fetchDeliveryGroupOptions(ctx.collegeId!),
  });

  const { data: rawSessions, isLoading: sessionsLoading } = useQuery({
    queryKey: [
      "plt-sess",
      ctx.collegeId,
      ctx.versionId,
      ctx.studySystem,
      deptId,
      progId,
      lvlId,
      groupId,
    ],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: () =>
      fetchProgramLevelTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        studySystem: ctx.studySystem,
        departmentId: deptId === "all" ? null : deptId,
        programId: progId === "all" ? null : progId,
        levelId: lvlId === "all" ? null : lvlId,
        deliveryGroupId: groupId === "all" ? null : groupId,
      }),
  });

  const groupLabels = useMemo(() => deliveryGroupLabelMap(groupOptions ?? []), [groupOptions]);
  const sessions = useMemo(
    () => mapRawSessions(rawSessions ?? [], groupLabels),
    [rawSessions, groupLabels],
  );
  const rows = useMemo(() => timetableSessionsToRows(sessions), [sessions]);
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);

  const isLoading = ctx.isLoading || sessionsLoading;
  const ready = !!ctx.versionId;

  return (
    <ReportShell
      title="تقرير جدول البرنامج/المستوى"
      description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع · ${sessions.length} محاضرة.`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="program_level_timetable"
      rows={rows}
      headers={TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      emptyMessage={!ready ? "اختر نسخة جدول." : "لا توجد محاضرات بهذه المعايير."}
      filters={
        <ReportFilters context={ctx}>
          <div>
            <label className="text-xs text-muted-foreground">القسم</label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(depts ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">البرنامج</label>
            <Select value={progId} onValueChange={setProgId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(progs ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">المستوى</label>
            <Select value={lvlId} onValueChange={setLvlId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(levels ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">مجموعات المحاضرات والمعامل (اختياري)</label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(groupOptions ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.group_code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && <ReportTimetableView sessions={sessions} />}
    </ReportShell>
  );
}
