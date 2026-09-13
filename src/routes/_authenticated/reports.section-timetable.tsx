import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Card } from "@/components/ui/card";
import { Archive } from "lucide-react";
import {
  mapRawSessions,
  timetableSessionsToRows,
  TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import { fetchSectionTimetableSessions } from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/reports/section-timetable")({
  head: () => ({ meta: [{ title: "أرشيف — تقرير جدول المجموعة (تاريخي)" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [sectionId, setSectionId] = useState("");

  const { data: sections, error: sectionsError } = useQuery({
    queryKey: ["st-sections", ctx.collegeId, ctx.termId],
    enabled: !!ctx.collegeId && !!ctx.termId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sections")
        .select("id, section_number, course_id, courses(code, name)")
        .eq("college_id", ctx.collegeId!)
        .eq("term_id", ctx.termId!)
        .order("section_number")
        .throwOnError();
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: rawSessions,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch,
  } = useQuery({
    queryKey: ["st-sess", ctx.collegeId, ctx.versionId, ctx.studySystem, sectionId],
    enabled: !!ctx.collegeId && !!ctx.versionId && !!sectionId,
    queryFn: () =>
      fetchSectionTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        sectionId,
        studySystem: ctx.studySystem,
      }),
  });

  const sessions = useMemo(() => mapRawSessions(rawSessions ?? []), [rawSessions]);
  const rows = useMemo(() => timetableSessionsToRows(sessions), [sessions]);
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);

  const isLoading = ctx.isLoading || sessionsLoading;
  const ready = !!ctx.versionId && !!sectionId;

  return (
    <div className="min-w-0 space-y-4">
      <Card className="report-no-print flex gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <Archive className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium text-amber-700">تقرير أرشيف — للعرض التاريخي فقط</p>
          <p className="text-xs text-muted-foreground">
            مصدره جداول <code className="text-[11px]">sections</code> المحفوظة للتوافق — قراءة فقط
            ولا تعتمد عليه تدفقات العمل الجديدة. للجداول الحديثة استخدم{" "}
            <Link
              to="/reports/program-level-timetable"
              className="text-primary underline-offset-4 hover:underline"
            >
              جدول البرنامج/المستوى
            </Link>{" "}
            بفلاتر الدفعة الدراسية ومجموعة المحاضرات/المعامل.
          </p>
        </div>
      </Card>
      <ReportShell
        title="تقرير جدول المجموعة (أرشيف)"
        description="جدول مجموعة واحدة من بيانات المجموعات القديمة المحفوظة."
        filterSummary={ctx.filterSummary}
        reportContext={ctx}
        filename="section_timetable"
        rows={rows}
        headers={TIMETABLE_TABLE_HEADERS}
        isLoading={isLoading}
        error={ctx.error ?? sectionsError ?? sessionsError}
        onRetry={() => void refetch()}
        notReadyMessage={ready ? undefined : "اختر نسخة جدول ومجموعة لعرض الجدول."}
        emptyMessage="لا توجد محاضرات لهذه المجموعة في النسخة المحددة."
        kpis={[
          { label: "المحاضرات", value: rows.length },
          { label: "ساعات/أسبوع", value: totalHours.toFixed(2), tone: "accent" },
          { label: "أيام الحضور", value: new Set(rows.map((r) => String(r.day))).size },
        ]}
        filters={
          <ReportFilters context={ctx} onClear={() => setSectionId("")}>
            <ReportFilterField label="المجموعة" htmlFor="st-section">
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger id="st-section" aria-label="المجموعة">
                  <SelectValue placeholder="اختر المجموعة" />
                </SelectTrigger>
                <SelectContent>
                  {(sections ?? []).map((s) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const c = (s as any).courses;
                    const label = c
                      ? `${s.section_number} — ${entityDisplayName(c, "مقرر غير متاح")}`
                      : s.section_number;
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </ReportFilterField>
          </ReportFilters>
        }
      >
        {ready && sessions.length > 0 && (
          <ReportTimetableView sessions={sessions} collegeId={ctx.collegeId} />
        )}
      </ReportShell>
    </div>
  );
}
