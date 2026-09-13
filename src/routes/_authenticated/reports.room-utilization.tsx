import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { filterRowsBySearch } from "@/lib/reports/search";
import { roomUtilizationMetrics } from "@/lib/reports/presentation-metrics";
import { readAllReportRows } from "@/lib/reports/read-all";

export const Route = createFileRoute("/_authenticated/reports/room-utilization")({
  head: () => ({ meta: [{ title: "تقرير استخدام القاعات" }] }),
  component: Page,
});
const columns = [
  { key: "room", label: "القاعة" },
  { key: "utilization_pct", label: "الاستخدام %", numeric: true },
  { key: "available_hours", label: "ساعات متاحة", numeric: true },
  { key: "occupied_hours", label: "ساعات مشغولة", numeric: true },
  { key: "idle_hours", label: "ساعات متاحة غير مستخدمة", numeric: true },
  { key: "status", label: "الحالة" },
  { key: "scheduled_hours", label: "مجموع ساعات المحاضرات", numeric: true, secondary: true },
  { key: "overlap_hours", label: "ساعات تداخل", numeric: true, secondary: true },
  { key: "outside_hours", label: "ساعات خارج الإتاحة", numeric: true, secondary: true },
  { key: "building", label: "المبنى", secondary: true },
  { key: "room_type", label: "نوع القاعة", secondary: true },
  { key: "capacity", label: "السعة الطلابية", numeric: true, secondary: true },
];
function Page() {
  const ctx = useReportContext({ fixedStudySystem: "all" });
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["report-room-utilization-v2", ctx.collegeId, ctx.versionId],
    enabled: !!ctx.collegeId && !!ctx.selectedVersion,
    queryFn: async () => {
      const collegeId = ctx.collegeId!;
      const [rooms, availability, sessions, settingsResult, roomTypes, buildings] =
        await Promise.all([
          readAllReportRows((from, to) =>
            supabase
              .from("rooms")
              .select(
                "id, code, name, capacity, available_days, available_start_time, available_end_time, room_type_id, building_id",
              )
              .eq("college_id", collegeId)
              .eq("is_active", true)
              .order("id")
              .range(from, to),
          ),
          readAllReportRows((from, to) =>
            supabase
              .from("room_availability")
              .select("id, room_id, day_of_week, start_time, end_time")
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
          readAllReportRows((from, to) =>
            supabase
              .from("schedule_sessions")
              .select("id, room_id, day_of_week, start_time, end_time")
              .eq("college_id", collegeId)
              .eq("schedule_version_id", ctx.selectedVersion!.id)
              .or("replaced_by_split.is.null,replaced_by_split.eq.false")
              .order("id")
              .range(from, to),
          ),
          supabase
            .from("scheduling_settings")
            .select("working_days, day_start_time, day_end_time")
            .eq("college_id", collegeId)
            .maybeSingle(),
          readAllReportRows((from, to) =>
            supabase
              .from("room_types")
              .select("id, name_ar")
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
          readAllReportRows((from, to) =>
            supabase
              .from("academic_buildings")
              .select("id, name")
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
        ]);
      if (settingsResult.error) throw settingsResult.error;
      return rooms.map((room) => {
        const metrics = roomUtilizationMetrics({
          settings: settingsResult.data,
          room,
          availability: availability.filter((a) => a.room_id === room.id),
          sessions: sessions.filter((s) => s.room_id === room.id),
        });
        return {
          ...metrics,
          room: [room.code, room.name].filter(Boolean).join(" — "),
          room_type: roomTypes.find((t) => t.id === room.room_type_id)?.name_ar ?? "—",
          building: buildings.find((b) => b.id === room.building_id)?.name ?? "—",
          capacity: room.capacity,
          utilization_pct: metrics.utilization_pct ?? "غير قابل للحساب",
          status:
            metrics.outside_hours > 0 || metrics.overlap_hours > 0
              ? "يحتاج مراجعة"
              : metrics.available_hours === 0
                ? "لا إتاحة"
                : metrics.occupied_hours === 0
                  ? "غير مستخدمة"
                  : "مستخدمة",
        };
      });
    },
  });
  const rows = filterRowsBySearch(query.data ?? [], search);
  const totalAvailable = rows.reduce((sum, r) => sum + r.available_hours, 0);
  const totalUsed = rows.reduce((sum, r) => sum + r.occupied_hours, 0);
  return (
    <ReportShell
      title="تقرير استخدام القاعات"
      description="استخدام القاعات في نسخة واحدة بحسب الدوام والإتاحة الفعلية. ساعات التداخل وخارج الإتاحة معروضة منفصلة."
      reportContext={ctx}
      filename="room_utilization"
      rows={rows}
      headers={columns}
      isLoading={ctx.isLoading || query.isLoading}
      error={ctx.error ?? query.error}
      onRetry={() => void query.refetch()}
      notReadyMessage={
        ctx.selectedVersion ? undefined : "اختر فصلًا ونسخة جدول لعرض استخدام القاعات."
      }
      emptyMessage={search ? "لا قاعة مطابقة للبحث." : "لا توجد قاعات نشطة في هذه الكلية."}
      kpis={[
        { label: "القاعات", value: rows.length },
        {
          label: "الاستخدام الكلي",
          value: totalAvailable
            ? `${((totalUsed / totalAvailable) * 100).toFixed(1)}%`
            : "غير قابل للحساب",
        },
        { label: "تحتاج مراجعة", value: rows.filter((r) => r.status === "يحتاج مراجعة").length },
        { label: "غير مستخدمة", value: rows.filter((r) => r.status === "غير مستخدمة").length },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          studySystem={false}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث بالقاعة أو المبنى أو النوع أو الحالة…",
          }}
          onClear={() => setSearch("")}
        />
      }
    >
      <ReportSection
        title="استخدام القاعات"
        hint="الاستخدام = الزمن المشغول داخل الإتاحة ÷ الزمن المتاح. لا تُحتسب الفترة المتداخلة مرتين."
      >
        <ReportDataTable
          columns={columns}
          rows={rows}
          caption="ساعات استخدام القاعات ونسب الاستغلال"
        />
      </ReportSection>
    </ReportShell>
  );
}
