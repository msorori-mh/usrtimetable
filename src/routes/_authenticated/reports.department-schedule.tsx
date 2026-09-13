import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Archive } from "lucide-react";
import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/export";
import { filterRowsBySearch } from "@/lib/reports/search";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/reports/department-schedule")({
  head: () => ({ meta: [{ title: "أرشيف — تقرير جدول الأقسام (تاريخي)" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState("");
  const [deptId, setDeptId] = useState("all");
  const [search, setSearch] = useState("");

  const { data: versions, error: versionsError } = useQuery({
    queryKey: ["ds-vers", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status")
          .eq("college_id", active!.id)
          .order("created_at", { ascending: false })
          .throwOnError()
      ).data ?? [],
  });
  const { data: depts } = useQuery({
    queryKey: ["ds-depts", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });

  const {
    data: sessions,
    isLoading,
    error: sessionsError,
    refetch,
  } = useQuery({
    queryKey: ["ds-sess", active?.id, versionId, deptId],
    enabled: !!active && !!versionId,
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_sessions")
        .select(
          `id, day_of_week, start_time, end_time, session_type,
          course_offerings!inner(courses!inner(name, code, department_id, departments(name)), academic_programs(name), academic_levels(name, level_number)),
          sections(section_number),
          instructors(full_name),
          rooms(code, name)`,
        )
        .eq("college_id", active!.id)
        .eq("schedule_version_id", versionId)
        .order("day_of_week")
        .order("start_time")
        .throwOnError();
      return data ?? [];
    },
  });

  const allRows = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((sessions ?? []) as any[])
      .filter((s) => deptId === "all" || s.course_offerings?.courses?.department_id === deptId)
      .map((s) => ({
        department: s.course_offerings?.courses?.departments?.name ?? "",
        program: s.course_offerings?.academic_programs?.name ?? "",
        level: s.course_offerings?.academic_levels?.name ?? "",
        section: s.sections?.section_number ?? "",
        course: entityDisplayName(s.course_offerings?.courses ?? {}, ""),
        day: DAY_NAMES_AR[s.day_of_week] ?? "",
        time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
        session_type: s.session_type === "lab" ? "عملي" : "نظري",
        instructor: s.instructors?.full_name ?? "",
        room: s.rooms ? entityDisplayName(s.rooms, "") : "",
      }));
  }, [sessions, deptId]);

  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

  const headers = [
    { key: "department", label: "القسم" },
    { key: "program", label: "البرنامج" },
    { key: "level", label: "المستوى" },
    { key: "section", label: "المجموعة" },
    { key: "course", label: "المقرر" },
    { key: "day", label: "اليوم" },
    { key: "time", label: "الوقت" },
    { key: "session_type", label: "النوع" },
    { key: "instructor", label: "المحاضر" },
    { key: "room", label: "القاعة" },
  ];

  const version = (versions ?? []).find((v) => v.id === versionId);
  const deptLabel = deptId === "all" ? "الكل" : (depts ?? []).find((d) => d.id === deptId)?.name;

  return (
    <div className="min-w-0 space-y-4">
      <Card className="report-no-print flex gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <Archive className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium text-amber-700">تقرير أرشيف — للعرض التاريخي فقط</p>
          <p className="text-xs text-muted-foreground">
            يعرض هوية <code className="text-[11px]">sections</code> القديمة — قراءة فقط ولا تعتمد
            عليه تدفقات العمل الجديدة. استخدم{" "}
            <Link
              to="/reports/program-level-timetable"
              className="text-primary underline-offset-4 hover:underline"
            >
              جدول البرنامج/المستوى
            </Link>{" "}
            بفلاتر الدفعة الدراسية ومجموعة المحاضرات/المعامل بدلاً منه.
          </p>
        </div>
      </Card>
      <ReportShell
        title="تقرير جدول الأقسام (أرشيف)"
        description="الجدول مجمّعًا حسب القسم/البرنامج/المستوى/المجموعة."
        filename="department_schedule"
        rows={rows}
        headers={headers}
        isLoading={isLoading}
        error={versionsError ?? sessionsError}
        onRetry={() => void refetch()}
        notReadyMessage={versionId ? undefined : "اختر نسخة جدول للبدء."}
        emptyMessage={search ? "لا نتائج مطابقة للبحث." : "لا توجد محاضرات."}
        kpis={[
          { label: "المحاضرات", value: rows.length },
          { label: "الأقسام", value: new Set(rows.map((r) => r.department)).size },
          { label: "المقررات", value: new Set(rows.map((r) => r.course)).size },
          { label: "المحاضرون", value: new Set(rows.map((r) => r.instructor)).size },
        ]}
        filters={
          <ReportFilterBar
            search={{ value: search, onChange: setSearch, placeholder: "ابحث بالمقرر أو المحاضر…" }}
            activeSummary={[
              `النسخة: ${version ? `${version.name} — ${version.status}` : "غير محددة"}`,
              `القسم: ${deptLabel ?? "—"}`,
            ]}
            onClear={() => {
              setDeptId("all");
              setSearch("");
            }}
            basic={
              <>
                <ReportFilterField label="نسخة الجدول" htmlFor="ds-version">
                  <Select value={versionId} onValueChange={setVersionId}>
                    <SelectTrigger id="ds-version" aria-label="نسخة الجدول">
                      <SelectValue placeholder="اختر نسخة" />
                    </SelectTrigger>
                    <SelectContent>
                      {(versions ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name} — {v.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReportFilterField>
                <ReportFilterField label="القسم" htmlFor="ds-dept">
                  <Select value={deptId} onValueChange={setDeptId}>
                    <SelectTrigger id="ds-dept" aria-label="القسم">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {(depts ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReportFilterField>
              </>
            }
          />
        }
      >
        <ReportSection
          title="محاضرات القسم"
          count={rows.length}
          hint="مرتبة حسب اليوم ثم الوقت — الأعمدة الثانوية تظهر على الشاشات الأوسع وفي الطباعة."
          bodyClassName="p-0"
        >
          <ReportDataTable
            rows={rows}
            minWidthClassName="min-w-[900px]"
            caption="جدول محاضرات الأقسام"
            columns={[
              { key: "department", label: "القسم" },
              { key: "program", label: "البرنامج", secondary: true },
              { key: "level", label: "المستوى", secondary: true },
              { key: "section", label: "المجموعة", secondary: true },
              { key: "course", label: "المقرر" },
              { key: "day", label: "اليوم" },
              { key: "time", label: "الوقت", className: "whitespace-nowrap" },
              { key: "session_type", label: "النوع" },
              { key: "instructor", label: "المحاضر", secondary: true },
              { key: "room", label: "القاعة", secondary: true },
            ]}
          />
        </ReportSection>
      </ReportShell>
    </div>
  );
}
