import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { usePublishedOnlyReports } from "@/hooks/reports/use-published-only-reports";
import { visibleVersionStatuses } from "@/lib/reports/published-only";
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
import { Badge } from "@/components/ui/badge";
import { filterRowsBySearch } from "@/lib/reports/search";

export const Route = createFileRoute("/_authenticated/reports/unscheduled")({
  head: () => ({ meta: [{ title: "تقرير المحاضرات غير المجدوَلة" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const publishedOnly = usePublishedOnlyReports();
  const [versionId, setVersionId] = useState("");
  const [search, setSearch] = useState("");

  const { data: versions, error: versionsError } = useQuery({
    queryKey: ["un-vers", active?.id, publishedOnly],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status, academic_term_id")
          .eq("college_id", active!.id)
          // Reports-only viewer: published versions only.
          .in("status", visibleVersionStatuses(publishedOnly))
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const version = useMemo(
    () => (versions ?? []).find((v) => v.id === versionId),
    [versions, versionId],
  );

  const {
    data: offerings,
    isLoading: oLoad,
    error: offeringsError,
    refetch,
  } = useQuery({
    queryKey: ["un-off", active?.id, version?.academic_term_id],
    enabled: !!active && !!version,
    queryFn: async () => {
      const { data } = await supabase
        .from("course_offerings")
        .select(
          `id, plan_course_id, courses(name, code),
          plan_courses(lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration)`,
        )
        .eq("college_id", active!.id)
        .eq("term_id", version!.academic_term_id);
      return data ?? [];
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["un-sess", active?.id, versionId],
    enabled: !!active && !!versionId,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_sessions")
          .select("course_offering_id, session_type")
          .eq("college_id", active!.id)
          .eq("schedule_version_id", versionId)
      ).data ?? [],
  });

  const { data: latestRun } = useQuery({
    queryKey: ["un-run", versionId],
    enabled: !!versionId,
    queryFn: async () =>
      (
        await supabase
          .from("auto_schedule_runs")
          .select("unplaced")
          .eq("schedule_version_id", versionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  const reasonsMap = useMemo(() => {
    const m = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (latestRun?.unplaced as any[]) ?? [];
    for (const u of arr) {
      const key = `${u.course_offering_id ?? u.offering_id ?? ""}|${u.session_type ?? ""}`;
      if (key && !m.has(key)) m.set(key, u.reason_ar ?? u.reason ?? "");
    }
    return m;
  }, [latestRun]);

  const allRows = useMemo(() => {
    const counts = new Map<string, { lec: number; lab: number }>();
    for (const s of sessions ?? []) {
      const c = counts.get(s.course_offering_id) ?? { lec: 0, lab: 0 };
      if (s.session_type === "lab") c.lab += 1;
      else c.lec += 1;
      counts.set(s.course_offering_id, c);
    }
    const out: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of (offerings ?? []) as any[]) {
      const pc = o.plan_courses;
      const reqLec = Number(pc?.lectures_per_week ?? 0);
      const reqLab = Number(pc?.labs_per_week ?? 0);
      const c = counts.get(o.id) ?? { lec: 0, lab: 0 };
      const missLec = Math.max(0, reqLec - c.lec);
      const missLab = Math.max(0, reqLab - c.lab);
      if (missLec + missLab === 0) continue;
      const course = `${o.courses?.code ?? ""} ${o.courses?.name ?? ""}`;
      if (missLec > 0)
        out.push({
          course,
          session_type: "نظري",
          required: reqLec,
          scheduled: c.lec,
          missing: missLec,
          reason: reasonsMap.get(`${o.id}|lecture`) ?? "",
        });
      if (missLab > 0)
        out.push({
          course,
          session_type: "عملي",
          required: reqLab,
          scheduled: c.lab,
          missing: missLab,
          reason: reasonsMap.get(`${o.id}|lab`) ?? "",
        });
    }
    return out;
  }, [offerings, sessions, reasonsMap]);

  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

  const headers = [
    { key: "course", label: "المقرر" },
    { key: "session_type", label: "النوع" },
    { key: "required", label: "المطلوب" },
    { key: "scheduled", label: "المجدوَل" },
    { key: "missing", label: "الناقص" },
    { key: "reason", label: "السبب" },
  ];

  const totalMissing = rows.reduce((s, r) => s + Number(r.missing ?? 0), 0);
  const totalRequired = rows.reduce((s, r) => s + Number(r.required ?? 0), 0);
  const affectedCourses = new Set(rows.map((r) => String(r.course))).size;

  return (
    <ReportShell
      title="تقرير المحاضرات غير المجدوَلة"
      description="المحاضرات المطلوبة وفق الخطط مقابل المجدوَلة فعليًا في النسخة المختارة."
      filename="unscheduled_sessions"
      rows={rows}
      headers={headers}
      isLoading={oLoad}
      error={versionsError ?? offeringsError}
      onRetry={() => void refetch()}
      notReadyMessage={versionId ? undefined : "اختر نسخة جدول لعرض النواقص."}
      emptyMessage={search ? "لا نتائج مطابقة للبحث." : "كل المحاضرات مجدوَلة."}
      kpis={[
        { label: "بنود ناقصة", value: rows.length },
        { label: "حصص ناقصة", value: totalMissing, tone: totalMissing > 0 ? "danger" : "neutral" },
        { label: "حصص مطلوبة", value: totalRequired },
        { label: "مقررات متأثرة", value: affectedCourses },
      ]}
      filters={
        <ReportFilterBar
          search={{ value: search, onChange: setSearch, placeholder: "ابحث بالمقرر أو السبب…" }}
          activeSummary={[
            `النسخة: ${version ? `${version.name} — ${version.status}` : "غير محددة"}`,
          ]}
          onClear={() => setSearch("")}
          basic={
            <ReportFilterField label="نسخة الجدول" htmlFor="un-version">
              <Select value={versionId} onValueChange={setVersionId}>
                <SelectTrigger id="un-version" aria-label="نسخة الجدول">
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
          }
        />
      }
    >
      <ReportSection
        title="البنود الناقصة"
        count={rows.length}
        hint="لكل مقرر ونوع حصة: المطلوب مقابل المجدوَل وسبب عدم الجدولة من آخر تشغيل آلي."
        bodyClassName="p-0"
      >
        <ReportDataTable
          rows={rows}
          caption="المحاضرات غير المجدولة"
          columns={[
            { key: "course", label: "المقرر" },
            { key: "session_type", label: "النوع" },
            { key: "required", label: "المطلوب", numeric: true },
            { key: "scheduled", label: "المجدوَل", numeric: true },
            {
              key: "missing",
              label: "الناقص",
              numeric: true,
              render: (r) => <Badge variant="destructive">{String(r.missing)}</Badge>,
            },
            {
              key: "reason",
              label: "السبب",
              secondary: true,
              className: "text-xs text-muted-foreground",
            },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}
