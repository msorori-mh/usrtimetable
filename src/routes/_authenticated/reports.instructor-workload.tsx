import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { useReportContext } from "@/hooks/reports/useReportContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { filterRowsBySearch } from "@/lib/reports/search";
import { hoursBetween } from "@/lib/reports/export";
import { QUOTA_UNDEFINED_AR, computeQuotaBalance } from "@/lib/reports/instructor-quota";

export const Route = createFileRoute("/_authenticated/reports/instructor-workload")({
  head: () => ({ meta: [{ title: "العبء المجدول للمحاضرين" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  return active ? (
    <WorkloadPage key={active.id} />
  ) : (
    <Card className="p-6">اختر كلية لعرض التقرير.</Card>
  );
}

function WorkloadPage() {
  const { active } = useActiveCollege();
  const context = useReportContext({ fixedStatusMode: "specific_version" });
  const [deptId, setDeptId] = useState<string>("all");
  const [typeId, setTypeId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: depts } = useQuery({
    queryKey: ["rep-depts", active?.id],
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
  const { data: types } = useQuery({
    queryKey: ["rep-itypes", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("instructor_types")
          .select("id, name_ar")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });

  const {
    data: instructors,
    isFetching: ilLoad,
    error: instructorError,
  } = useQuery({
    queryKey: ["rep-iw-ins", active?.id, deptId, typeId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("instructors")
        .select(
          "id, full_name, academic_rank, max_weekly_hours, administrative_release_hours, department_id, instructor_type_id, departments(name), instructor_types(name_ar)",
        )
        .eq("college_id", active!.id);
      if (deptId !== "all") q = q.eq("department_id", deptId);
      if (typeId !== "all") q = q.eq("instructor_type_id", typeId);
      const { data, error } = await q.throwOnError();
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: sessions,
    isFetching: sLoad,
    error: sessionError,
  } = useQuery({
    queryKey: ["rep-iw-sess", active?.id, context.versionId],
    enabled: !!active && !!context.selectedVersion,
    queryFn: async () => {
      const query = () =>
        supabase
          .from("schedule_sessions")
          .select("instructor_id, start_time, end_time, course_offering_id, source_type")
          .eq("college_id", active!.id)
          .eq("schedule_version_id", context.versionId!)
          .eq("replaced_by_split", false)
          .order("id");
      const rows = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await query().range(from, from + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < 500) return rows;
      }
    },
  });

  const allRows = useMemo(() => {
    if (
      !context.selectedVersion ||
      context.error ||
      instructorError ||
      sessionError ||
      ilLoad ||
      sLoad
    )
      return [];
    const byIns = new Map<
      string,
      { hours: number; offerings: Set<string>; sources: Record<string, number> }
    >();
    for (const s of sessions ?? []) {
      const m = byIns.get(s.instructor_id) ?? {
        hours: 0,
        offerings: new Set(),
        sources: {},
      };
      m.hours += hoursBetween(s.start_time as string, s.end_time as string);
      m.offerings.add(s.course_offering_id as string);
      const st = (s.source_type as string) ?? "manual";
      m.sources[st] = (m.sources[st] ?? 0) + 1;
      byIns.set(s.instructor_id, m);
    }
    return (instructors ?? []).map((i) => {
      const agg = byIns.get(i.id) ?? {
        hours: 0,
        offerings: new Set(),
        sources: {},
      };
      // A missing approved load must never be read as a zero quota.
      const balance = computeQuotaBalance({
        maxWeeklyHours: i.max_weekly_hours,
        adminReleaseHours: i.administrative_release_hours,
        assignedHours: agg.hours,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dep = (i as any).departments?.name ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typ = (i as any).instructor_types?.name_ar ?? "";
      const srcStr = Object.entries(agg.sources)
        .map(([k, v]) => `${k}:${v}`)
        .join(" | ");
      return {
        instructor: i.full_name,
        department: dep,
        rank: i.academic_rank ?? "",
        type: typ,
        max_weekly_hours: balance.baseHours ?? QUOTA_UNDEFINED_AR,
        admin_release: balance.releaseHours,
        effective_quota: balance.netHours ?? QUOTA_UNDEFINED_AR,
        scheduled_hours: balance.assignedHours,
        overload: balance.overloadHours ?? QUOTA_UNDEFINED_AR,
        underload: balance.deficitHours ?? QUOTA_UNDEFINED_AR,
        courses_count: agg.offerings.size,
        source_breakdown: srcStr,
      };
    });
  }, [
    instructors,
    sessions,
    context.selectedVersion,
    context.error,
    instructorError,
    sessionError,
    ilLoad,
    sLoad,
  ]);

  // Search is presentation-only: identical row keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

  const headers = [
    { key: "instructor", label: "المحاضر" },
    { key: "department", label: "القسم" },
    { key: "rank", label: "الرتبة" },
    { key: "type", label: "النوع" },
    { key: "max_weekly_hours", label: "النصاب الأساسي المعتمد" },
    { key: "admin_release", label: "التخفيض الإداري" },
    { key: "effective_quota", label: "صافي النصاب المعتمد" },
    { key: "scheduled_hours", label: "ساعات مجدوَلة" },
    { key: "overload", label: "زيادة" },
    { key: "underload", label: "نقص" },
    { key: "courses_count", label: "عدد المقررات" },
    { key: "source_breakdown", label: "تفصيل المصدر" },
  ];

  const totalHours = rows.reduce((sum, r) => sum + Number(r.scheduled_hours ?? 0), 0);
  const overloaded = rows.filter((r) => Number(r.overload) > 0).length;
  const underloaded = rows.filter((r) => Number(r.underload) > 0).length;
  const deptLabel =
    deptId === "all" ? "كل الأقسام" : (depts ?? []).find((d) => d.id === deptId)?.name;
  const typeLabel =
    typeId === "all" ? "كل الأنواع" : (types ?? []).find((t) => t.id === typeId)?.name_ar;

  return (
    <ReportShell
      title="العبء المجدول للمحاضرين"
      description="الساعات المجدولة في نسخة واحدة، ومقارنتها بالحد الأسبوعي المسجل للمحاضر. لتقارير النصاب المعتمد استخدم تقارير الشؤون الأكاديمية."
      filename="instructor_workload"
      rows={rows}
      headers={headers}
      isLoading={context.isLoading || ilLoad || sLoad}
      error={context.error ?? instructorError ?? sessionError}
      reportContext={context}
      filterSummary={context.filterSummary}
      notReadyMessage={context.selectedVersion ? undefined : "اختر فصلاً ونسخة جدول لعرض الساعات."}
      emptyMessage={search ? "لا محاضر مطابق للبحث." : "لا توجد بيانات بهذه المعايير."}
      kpis={[
        { label: "المحاضرون", value: rows.length },
        { label: "إجمالي الساعات", value: totalHours.toFixed(2), tone: "accent" },
        {
          label: "يتجاوز الحد الأسبوعي",
          value: overloaded,
          tone: overloaded > 0 ? "danger" : "neutral",
        },
        {
          label: "أقل من الحد الأسبوعي",
          value: underloaded,
          tone: underloaded > 0 ? "warning" : "neutral",
        },
      ]}
      filters={
        <ReportFilters
          context={context}
          statusMode={false}
          studySystem={false}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث باسم المحاضر أو القسم…",
          }}
          extraSummary={[`القسم: ${deptLabel ?? "—"}`, `النوع: ${typeLabel ?? "—"}`]}
          onClear={() => {
            setDeptId("all");
            setTypeId("all");
            setSearch("");
          }}
          advanced={
            <>
              <FilterSelect
                label="القسم"
                value={deptId}
                onChange={setDeptId}
                items={[
                  { id: "all", name: "الكل" },
                  ...(depts ?? []).map((d) => ({ id: d.id, name: d.name })),
                ]}
              />
              <FilterSelect
                label="نوع المحاضر"
                value={typeId}
                onChange={setTypeId}
                items={[
                  { id: "all", name: "الكل" },
                  ...(types ?? []).map((t) => ({ id: t.id, name: t.name_ar })),
                ]}
              />
            </>
          }
        />
      }
    >
      <ReportSection
        title="أعباء المحاضرين"
        count={rows.length}
        hint="الساعات المجدولة مقابل الحد الأسبوعي بعد الخصم الإداري."
        bodyClassName="p-0"
      >
        <ReportDataTable
          rows={rows}
          minWidthClassName="min-w-[900px]"
          caption="أعباء المحاضرين الأسبوعية"
          columns={[
            { key: "instructor", label: "المحاضر" },
            { key: "department", label: "القسم", secondary: true },
            { key: "rank", label: "الرتبة", secondary: true },
            { key: "type", label: "النوع", secondary: true },
            { key: "max_weekly_hours", label: "الحد الأسبوعي", numeric: true },
            { key: "admin_release", label: "خصم إداري", numeric: true, secondary: true },
            { key: "scheduled_hours", label: "ساعات مجدوَلة", numeric: true },
            {
              key: "overload",
              label: "زيادة",
              numeric: true,
              render: (r) =>
                Number(r.overload) > 0 ? (
                  <Badge variant="destructive">{r.overload}</Badge>
                ) : (
                  String(r.overload)
                ),
            },
            {
              key: "underload",
              label: "نقص",
              numeric: true,
              render: (r) =>
                Number(r.underload) > 0 ? (
                  <Badge variant="secondary">{r.underload}</Badge>
                ) : (
                  String(r.underload)
                ),
            },
            { key: "courses_count", label: "عدد المقررات", numeric: true, secondary: true },
            {
              key: "source_breakdown",
              label: "تفصيل المصدر",
              secondary: true,
              className: "text-xs",
            },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <div className="min-w-0">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
