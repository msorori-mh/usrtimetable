import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  ReportSection,
  ReportDataTable,
  type ReportColumn,
} from "@/components/reports/report-section";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { filterRowsBySearch } from "@/lib/reports/search";
import { roomUtilizationMetrics } from "@/lib/reports/presentation-metrics";
import { readAllReportRows } from "@/lib/reports/read-all";
import { entityDisplayName } from "@/lib/entity-display";

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

type RoomUtilizationDisplayRow = Record<string, string | number>;

const roomUtilText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function RoomIdentityCell({ row }: { row: RoomUtilizationDisplayRow }) {
  return (
    <div className="min-w-[175px] space-y-0.5 leading-5">
      <div className="font-semibold">{roomUtilText(row.room)}</div>
      <div className="text-[11px] text-muted-foreground">
        {roomUtilText(row.room_type)} · السعة {roomUtilText(row.capacity)}
      </div>
      {row.building !== "—" && (
        <div className="text-[10px] text-muted-foreground">{roomUtilText(row.building)}</div>
      )}
    </div>
  );
}

function RoomTimeCell({ row }: { row: RoomUtilizationDisplayRow }) {
  return (
    <div className="min-w-[150px] space-y-0.5 leading-5">
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">متاح</span>
        <span className="tabular-nums">{roomUtilText(row.available_hours)} س</span>
      </div>
      <div className="flex justify-between gap-3 font-semibold">
        <span>مشغول فعليًا</span>
        <span className="tabular-nums">{roomUtilText(row.occupied_hours)} س</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">غير مستخدم</span>
        <span className="tabular-nums">{roomUtilText(row.idle_hours)} س</span>
      </div>
    </div>
  );
}

function RoomUtilizationCell({ row }: { row: RoomUtilizationDisplayRow }) {
  return (
    <div className="min-w-[135px] space-y-1 leading-5">
      <div className="text-xl font-bold tabular-nums">{roomUtilText(row.utilization_pct)}%</div>
      <div className="text-[11px] text-muted-foreground">{roomUtilText(row.status)}</div>
      <div className="text-[10px] text-muted-foreground">
        مجدول خام: {roomUtilText(row.scheduled_hours)} س
      </div>
    </div>
  );
}

function RoomAnomalyCell({ row }: { row: RoomUtilizationDisplayRow }) {
  const overlap = Number(row.overlap_hours);
  const outside = Number(row.outside_hours);
  const clean =
    (!Number.isFinite(overlap) || overlap <= 0) && (!Number.isFinite(outside) || outside <= 0);
  return (
    <div className="min-w-[150px] space-y-0.5 leading-5">
      {clean ? (
        <div className="font-semibold">لا توجد مخالفات زمنية</div>
      ) : (
        <>
          {overlap > 0 && (
            <div className="font-semibold">تداخل جلسات: {roomUtilText(row.overlap_hours)} س</div>
          )}
          {outside > 0 && (
            <div className="font-semibold">خارج الإتاحة: {roomUtilText(row.outside_hours)} س</div>
          )}
        </>
      )}
    </div>
  );
}

function compactRoomUtilizationColumns(): ReportColumn<RoomUtilizationDisplayRow>[] {
  return [
    {
      key: "room",
      label: "القاعة / المعمل",
      className: "w-[30%]",
      render: (row) => <RoomIdentityCell row={row} />,
    },
    {
      key: "occupied_hours",
      label: "استخدام الوقت",
      className: "w-[25%]",
      render: (row) => <RoomTimeCell row={row} />,
    },
    {
      key: "utilization_pct",
      label: "نسبة الاستغلال",
      className: "w-[20%]",
      render: (row) => <RoomUtilizationCell row={row} />,
    },
    {
      key: "overlap_hours",
      label: "ملاحظات التشغيل",
      className: "w-[25%]",
      render: (row) => <RoomAnomalyCell row={row} />,
    },
  ];
}

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
          room: entityDisplayName(room),
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
  const totalIdle = rows.reduce((sum, r) => sum + r.idle_hours, 0);
  const anomalyHours = rows.reduce(
    (sum, r) => sum + Number(r.overlap_hours || 0) + Number(r.outside_hours || 0),
    0,
  );
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
          tone: "accent",
        },
        { label: "ساعات غير مستخدمة", value: totalIdle.toFixed(1) },
        {
          label: "ساعات مخالفة",
          value: anomalyHours.toFixed(1),
          tone: anomalyHours > 0 ? "danger" : "neutral",
        },
        { label: "تحتاج مراجعة", value: rows.filter((r) => r.status === "يحتاج مراجعة").length },
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
          columns={
            compactRoomUtilizationColumns() as unknown as ReportColumn<(typeof rows)[number]>[]
          }
          rows={rows}
          primaryColumnLimit={5}
          minWidthClassName="min-w-[700px]"
          caption="ساعات استخدام القاعات ونسب الاستغلال"
        />
      </ReportSection>
    </ReportShell>
  );
}
