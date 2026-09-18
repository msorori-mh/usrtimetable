import { createFileRoute } from "@tanstack/react-router";
import { FacultyUniversityReport } from "@/components/reports/faculty-university-report";
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
import {
  ReportSection,
  ReportDataTable,
  type ReportColumn,
} from "@/components/reports/report-section";
import { filterRowsBySearch } from "@/lib/reports/search";
import { hoursBetween } from "@/lib/reports/export";
import { PENDING_QUOTA_AR, PENDING_SPLIT_AR } from "@/lib/existing-schedules/presentation";
import { QUOTA_UNDEFINED_AR, computeQuotaBalance } from "@/lib/reports/instructor-quota";

export const Route = createFileRoute("/_authenticated/reports/instructor-workload")({
  head: () => ({ meta: [{ title: "العبء المجدول للمحاضرين" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [university, setUniversity] = useState(false);
  return (
    <>
      <div className="mb-4 flex gap-3 print:hidden">
        <button className="rounded border px-4 py-2" onClick={() => setUniversity(false)}>
          عبء الكلية
        </button>
        <button className="rounded border px-4 py-2" onClick={() => setUniversity(true)}>
          النصاب والجدول عبر الكليات
        </button>
      </div>
      {university ? (
        <FacultyUniversityReport />
      ) : active ? (
        <WorkloadPage key={active.id} />
      ) : (
        <Card className="p-6">اختر كلية لعرض التقرير.</Card>
      )}
    </>
  );
}


type InstructorWorkloadDisplayRow = Record<string, string | number>;

const workloadText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function WorkloadInstructorCell({ row }: { row: InstructorWorkloadDisplayRow }) {
  return (
    <div className="min-w-[180px] space-y-0.5 leading-5">
      <div className="font-semibold">{workloadText(row.instructor)}</div>
      {row.employee_number && row.employee_number !== "—" && (
        <div className="text-[10px] tabular-nums text-muted-foreground">
          رقم الموظف: {workloadText(row.employee_number)}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {[row.rank, row.department, row.type].filter(Boolean).map(workloadText).join(" · ")}
      </div>
    </div>
  );
}

function WorkloadQuotaCell({ row }: { row: InstructorWorkloadDisplayRow }) {
  return (
    <div className="min-w-[140px] space-y-0.5 leading-5">
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">الأساسي</span>
        <span className="tabular-nums">{workloadText(row.max_weekly_hours)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">الإعفاء</span>
        <span className="tabular-nums">{workloadText(row.admin_release)}</span>
      </div>
      <div className="flex justify-between gap-3 font-semibold">
        <span>الصافي</span>
        <span className="tabular-nums">{workloadText(row.effective_quota)}</span>
      </div>
    </div>
  );
}

function ScheduledLoadCell({ row }: { row: InstructorWorkloadDisplayRow }) {
  return (
    <div className="min-w-[135px] space-y-0.5 leading-5">
      <div className="flex justify-between gap-3 font-semibold">
        <span>المجدول</span>
        <span className="tabular-nums">{workloadText(row.scheduled_hours)} س</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {workloadText(row.courses_count)} مقرر/مقررات
      </div>
      {row.source_breakdown && (
        <div className="text-[10px] text-muted-foreground">
          المصدر: {workloadText(row.source_breakdown)}
        </div>
      )}
    </div>
  );
}

function WorkloadBalanceCell({ row }: { row: InstructorWorkloadDisplayRow }) {
  const overload = Number(row.overload);
  const underload = Number(row.underload);
  const unknown = !Number.isFinite(overload) && !Number.isFinite(underload);
  const label = unknown
    ? workloadText(row.status)
    : overload > 0
      ? `زيادة ${overload} س`
      : underload > 0
        ? `نقص ${underload} س`
        : "ضمن النصاب";
  return (
    <div className="min-w-[155px] space-y-1 leading-5">
      <div className="font-semibold">{label}</div>
      <div className="text-[11px] text-muted-foreground">{workloadText(row.status)}</div>
    </div>
  );
}

function compactInstructorWorkloadColumns(): ReportColumn<InstructorWorkloadDisplayRow>[] {
  return [
    {
      key: "instructor",
      label: "المحاضر",
      className: "w-[30%]",
      render: (row) => <WorkloadInstructorCell row={row} />,
    },
    {
      key: "effective_quota",
      label: "النصاب الأسبوعي",
      className: "w-[22%]",
      render: (row) => <WorkloadQuotaCell row={row} />,
    },
    {
      key: "scheduled_hours",
      label: "العبء المجدول",
      className: "w-[22%]",
      render: (row) => <ScheduledLoadCell row={row} />,
    },
    {
      key: "status",
      label: "الرصيد والحالة",
      className: "w-[26%]",
      render: (row) => <WorkloadBalanceCell row={row} />,
    },
  ];
}

const WORKLOAD_SOURCE_LABELS: Record<string, string> = {
  manual: "يدوي",
  auto: "تلقائي",
  imported: "مستورد",
  existing_schedule: "جدول سابق",
  split: "تدريس مشترك",
};

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
          "id, full_name, employee_number, academic_rank, max_weekly_hours, administrative_release_hours, department_id, instructor_type_id, departments(name), instructor_types(name_ar)",
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
          .select(
            "id, instructor_id, delivery_group_id, start_time, end_time, course_offering_id, source_type",
          )
          .eq("college_id", active!.id)
          .eq("schedule_version_id", context.versionId!)
          .eq("replaced_by_split", false)
          .order("id");
      const rows = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await query().range(from, from + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < 500) break;
      }
      const { data: sources, error } = await supabase
        .from("existing_schedule_source_rows")
        .select("schedule_session_id,instructor_ids,shared_member")
        .eq("schedule_version_id", context.versionId!)
        .eq("shared_member", false);
      if (error) throw error;
      const shared = (sources ?? []).filter((s) => s.instructor_ids.length > 1);
      const groupIds = rows
        .filter((r) => shared.some((s) => s.schedule_session_id === r.id))
        .map((r) => r.delivery_group_id)
        .filter((id): id is string => !!id);
      const allocations = groupIds.length
        ? await supabase
            .from("teaching_assignments")
            .select("delivery_group_id,instructor_id,assigned_component_hours")
            .in("delivery_group_id", groupIds)
            .eq("is_active", true)
        : { data: [], error: null };
      if (allocations.error) throw allocations.error;
      return rows.flatMap((row) => {
        const source = shared.find((s) => s.schedule_session_id === row.id);
        if (!source)
          return [
            {
              ...row,
              split_pending: false,
              credited_hours: null as number | null,
            },
          ];
        return source.instructor_ids.map((id) => {
          const allocated =
            allocations.data?.find(
              (a) => a.delivery_group_id === row.delivery_group_id && a.instructor_id === id,
            )?.assigned_component_hours ?? null;
          return {
            ...row,
            instructor_id: id,
            split_pending: allocated === null,
            credited_hours: allocated,
          };
        });
      });
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
      {
        hours: number;
        credited: number;
        pending: boolean;
        offerings: Set<string>;
        sources: Record<string, number>;
      }
    >();
    for (const s of sessions ?? []) {
      const m = byIns.get(s.instructor_id) ?? {
        hours: 0,
        credited: 0,
        pending: false,
        offerings: new Set(),
        sources: {},
      };
      m.hours += hoursBetween(s.start_time as string, s.end_time as string);
      m.credited += s.credited_hours ?? hoursBetween(s.start_time as string, s.end_time as string);
      m.pending ||= s.split_pending;
      m.offerings.add(s.course_offering_id as string);
      const st = (s.source_type as string) ?? "manual";
      m.sources[st] = (m.sources[st] ?? 0) + 1;
      byIns.set(s.instructor_id, m);
    }
    return (instructors ?? []).map((i) => {
      const agg = byIns.get(i.id) ?? {
        hours: 0,
        credited: 0,
        pending: false,
        offerings: new Set(),
        sources: {},
      };
      // A missing approved load must never be read as a zero quota.
      const balance = computeQuotaBalance({
        maxWeeklyHours: i.max_weekly_hours,
        adminReleaseHours: i.administrative_release_hours,
        assignedHours: agg.credited,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dep = (i as any).departments?.name ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typ = (i as any).instructor_types?.name_ar ?? "";
      const srcStr = Object.entries(agg.sources)
        .map(([k, v]) => `${WORKLOAD_SOURCE_LABELS[k] ?? k}: ${v}`)
        .join(" · ");
      return {
        instructor: i.full_name,
        employee_number: i.employee_number ?? "—",
        department: dep,
        rank: i.academic_rank ?? "",
        type: typ,
        max_weekly_hours: balance.baseHours ?? QUOTA_UNDEFINED_AR,
        admin_release: balance.releaseHours,
        effective_quota: balance.netHours ?? QUOTA_UNDEFINED_AR,
        scheduled_hours: agg.hours,
        status:
          balance.netHours === null ? PENDING_QUOTA_AR : agg.pending ? PENDING_SPLIT_AR : "مكتمل",
        overload: agg.pending ? QUOTA_UNDEFINED_AR : (balance.overloadHours ?? QUOTA_UNDEFINED_AR),
        underload: agg.pending ? QUOTA_UNDEFINED_AR : (balance.deficitHours ?? QUOTA_UNDEFINED_AR),
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
    { key: "employee_number", label: "الرقم الوظيفي" },
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
    { key: "status", label: "الحالة" },
  ];

  const totalHours = rows.reduce((sum, r) => sum + Number(r.scheduled_hours ?? 0), 0);
  const overloaded = rows.filter((r) => Number(r.overload) > 0).length;
  const underloaded = rows.filter((r) => Number(r.underload) > 0).length;
  const pending = rows.filter(
    (r) => r.status === PENDING_QUOTA_AR || r.status === PENDING_SPLIT_AR,
  ).length;
  const deptLabel =
    deptId === "all" ? "كل الأقسام" : (depts ?? []).find((d) => d.id === deptId)?.name;
  const typeLabel =
    typeId === "all" ? "كل الأنواع" : (types ?? []).find((t) => t.id === typeId)?.name_ar;

  return (
    <ReportShell
      title="العبء المجدول للمحاضرين"
      description="الساعات المجدولة في نسخة واحدة، ومقارنتها بالحد الأسبوعي المسجل للمحاضر. لتقارير النصاب المعتمد استخدم تقارير الشؤون الأكاديمية."
      filename="instructor_workload"
      printOrientation="landscape"
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
        {
          label: "إجمالي الساعات",
          value: totalHours.toFixed(2),
          tone: "accent",
        },
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
        {
          label: "بيانات معلقة",
          value: pending,
          tone: pending > 0 ? "warning" : "neutral",
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
          minWidthClassName="min-w-[720px]"
          primaryColumnLimit={5}
          caption="أعباء المحاضرين الأسبوعية"
          columns={
            compactInstructorWorkloadColumns() as ReportColumn<(typeof rows)[number]>
          }
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
