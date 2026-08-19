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
import { ChevronDown, ListTodo } from "lucide-react";

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
  const [expanded, setExpanded] = useState(false);
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
      <CardHeader className="p-0">
        <button
          type="button"
          data-testid="builder-unscheduled-work-toggle"
          className="flex w-full items-center justify-between gap-3 p-4 text-right"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <CardTitle className="text-base">جلسات تحتاج الإضافة</CardTitle>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                افتح القائمة لإضافة التكليفات غير المجدولة إلى النسخة الحالية.
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant={payload?.rows.length ? "destructive" : "secondary"}>
              {query.isLoading ? "…" : `${payload?.rows.length ?? 0} متبقية`}
            </Badge>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-3 border-t pt-4">
          <div className="flex justify-end">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-48" aria-label="تصفية حالات التكليفات">
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
          </div>
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
      ) : null}
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
