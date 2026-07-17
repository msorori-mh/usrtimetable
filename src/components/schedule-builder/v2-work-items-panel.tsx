import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { V2AddSessionDialog } from "@/components/schedule-builder/v2-add-session-dialog";
import type { WorkspaceRoomOption } from "@/lib/schedule-builder/queries";
import {
  SCHEDULING_STATUS_LABEL_AR,
  blockingReasonLabelAr,
  type ScheduleBuilderV2WorkItem,
} from "@/lib/schedule-builder/v2-assignment-integration";
import { listScheduleBuilderV2WorkItems } from "@/lib/schedule-builder/v2-assignment-service";

export function V2WorkItemsPanel({
  scheduleVersionId,
  studySystem,
  rooms,
  canManage,
}: {
  scheduleVersionId: string;
  studySystem: string;
  rooms: WorkspaceRoomOption[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<ScheduleBuilderV2WorkItem | null>(null);
  const query = useQuery({
    queryKey: ["schedule-builder", "v2-work-items", scheduleVersionId, studySystem, status],
    queryFn: () =>
      listScheduleBuilderV2WorkItems({
        scheduleVersionId,
        studySystem,
        schedulingStatus: status === "all" ? null : status,
      }),
  });

  const payload = query.data;
  const mayCreate = canManage && !!payload?.can_manage && payload.version_status === "draft";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">التكليفات غير المجدولة</CardTitle>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(SCHEDULING_STATUS_LABEL_AR).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isLoading ? <p className="text-sm text-muted-foreground">جارٍ التحميل…</p> : null}
        {query.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>تعذر تحميل التكليفات.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : null}
        {payload && payload.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تكليفات مطابقة.</p>
        ) : null}
        {payload?.rows.map((item) => (
          <div
            key={item.teaching_assignment_id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {item.course_code} — {item.course_name}
                </span>
                <Badge variant={item.can_create_session ? "secondary" : "destructive"}>
                  {SCHEDULING_STATUS_LABEL_AR[item.scheduling_status]}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {item.instructor_name} · {item.group_code || item.cohort_code || "—"}
              </p>
              <p className="text-muted-foreground">
                مكلف: {item.assigned_component_hours} · مجدول: {item.currently_scheduled_hours} ·
                متبقي: {item.remaining_schedule_hours}
              </p>
              {item.blocking_reason ? (
                <p className="text-destructive">{blockingReasonLabelAr(item.blocking_reason)}</p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!mayCreate || !item.can_create_session}
              onClick={() => setSelected(item)}
            >
              إضافة إلى الجدول
            </Button>
          </div>
        ))}
      </CardContent>
      <V2AddSessionDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        workItem={selected}
        scheduleVersionId={scheduleVersionId}
        expectedVersionUpdatedAt={payload?.version_updated_at ?? ""}
        rooms={rooms}
        onCreated={() => {
          setSelected(null);
          void queryClient.invalidateQueries({ queryKey: ["schedule-builder"] });
        }}
      />
    </Card>
  );
}
