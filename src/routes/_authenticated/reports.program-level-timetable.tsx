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
  const [cohortId, setCohortId] = useState("all");
  const [dgId, setDgId] = useState("all");

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

  // A1.5: New Flow cohort/DG filter sources replace the Legacy sections selector.
  const { data: cohorts } = useQuery({
    queryKey: ["plt-cohorts", ctx.collegeId, ctx.termId],
    enabled: !!ctx.collegeId && !!ctx.termId,
    queryFn: async () =>
      (
        await supabase
          .from("academic_cohorts")
          .select("id, code")
          .eq("college_id", ctx.collegeId!)
          .eq("term_id", ctx.termId!)
          .order("code")
      ).data ?? [],
  });

  const { data: deliveryGroups } = useQuery({
    queryKey: ["plt-dgs", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () =>
      (
        await supabase
          .from("delivery_groups")
          .select("id, group_code, cohort_id")
          .eq("college_id", ctx.collegeId!)
          .order("group_code")
      ).data ?? [],
  });

  const filteredDeliveryGroups = useMemo(
    () =>
      (deliveryGroups ?? []).filter(
        (d) => cohortId === "all" || (d.cohort_id as string | null) === cohortId,
      ),
    [deliveryGroups, cohortId],
  );

  const { data: sessionsBundle, isLoading: sessionsLoading } = useQuery({
    queryKey: [
      "plt-sess",
      ctx.collegeId,
      ctx.versionId,
      ctx.studySystem,
      deptId,
      progId,
      lvlId,
      cohortId,
      dgId,
    ],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: async () => {
      const raw = await fetchProgramLevelTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        studySystem: ctx.studySystem,
        departmentId: deptId === "all" ? null : deptId,
        programId: progId === "all" ? null : progId,
        levelId: lvlId === "all" ? null : lvlId,
        cohortId: cohortId === "all" ? null : cohortId,
        deliveryGroupId: dgId === "all" ? null : dgId,
      });
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
  const ready = !!ctx.versionId;

  return (
    <ReportShell
      title="تقرير جدول البرنامج/المستوى"
      description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع · ${sessions.length} محاضرة.`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="program_level_timetable"
      rows={rows}
      headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
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
            <label className="text-xs text-muted-foreground">الدفعة الدراسية</label>
            <Select
              value={cohortId}
              onValueChange={(v) => {
                setCohortId(v);
                setDgId("all");
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(cohorts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">مجموعة المحاضرات/المعامل</label>
            <Select value={dgId} onValueChange={setDgId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {filteredDeliveryGroups.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.group_code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <ReportTimetableView sessions={sessions} headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS} />
      )}
    </ReportShell>
  );
}
