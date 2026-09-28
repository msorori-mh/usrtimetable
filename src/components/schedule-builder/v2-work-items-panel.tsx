import { useEffect, useMemo, useState } from "react";
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
import { entityDisplayName } from "@/lib/entity-display";

export function V2WorkItemsPanel({
  scheduleVersionId,
  studySystem,
  rooms,
  canManage,
  instructorIds,
}: {
  scheduleVersionId: string;
  studySystem: string;
  rooms: WorkspaceRoomOption[];
  canManage: boolean;
  /** Identity aliases for instructor-focused manual building; undefined means all instructors. */
  instructorIds?: readonly string[];
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<ScheduleBuilderV2WorkItem | null>(null);
  const [expanded, setExpanded] = useState(false);
  const instructorScopeKey = useMemo(
    () => (instructorIds ? [...instructorIds].sort().join(",") : "all"),
    [instructorIds],
  );
  const query = useQuery({
    queryKey: [
      "schedule-builder",
      "v2-work-items",
      scheduleVersionId,
      studySystem,
      status,
      instructorScopeKey,
    ],
    queryFn: () =>
      listScheduleBuilderV2WorkItems({
        scheduleVersionId,
        studySystem,
        schedulingStatus: status === "all" ? null : status,
      }),
  });

  const payload = query.data;
  const rows = useMemo(() => {
    if (!payload) return [];
    if (!instructorIds) return payload.rows;
    const allowed = new Set(instructorIds);
    return payload.rows.filter((row) => allowed.has(row.instructor_id));
  }, [payload, instructorIds]);
  const groupedRows = useMemo(
    () => [
      {
        key: "ready",
        label: "جاهزة للإضافة",
        rows: rows.filter((row) => row.can_create_session),
      },
      {
        key: "blocked",
        label: "تحتاج معالجة قبل الجدولة",
        rows: rows.filter((row) => !row.can_create_session),
      },
    ],
    [rows],
  );

  useEffect(() => {
    setSelected(null);
  }, [instructorScopeKey]);

  const mayShowCreateAction = canManage && !!payload?.can_manage;
  const mayCreate = canManage && !!payload?.can_manage && payload.version_status === "draft";

  return (
    <Card className="min-w-0">
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
            <Badge variant={rows.length ? "destructive" : "secondary"}>
              {query.isLoading ? "…" : `${rows.length} متبقية`}
            </Badge>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent className="min-w-0 space-y-3 border-t pt-4">
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
          {payload && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد تكليفات مطابقة.</p>
          ) : null}
          {groupedRows.map((group) =>
            group.rows.length ? (
              <section key={group.key} className="space-y-2" aria-label={group.label}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{group.label}</p>
                  <Badge variant={group.key === "ready" ? "secondary" : "destructive"}>
                    {group.rows.length}
                  </Badge>
                </div>
                {group.rows.map((item) => (
                  <div
                    key={item.teaching_assignment_id}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {entityDisplayName({ name: item.course_name, code: item.course_code })}
                        </span>
                        <Badge variant={item.can_create_session ? "secondary" : "destructive"}>
                          {SCHEDULING_STATUS_LABEL_AR[item.scheduling_status]}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">
                        {item.instructor_name} · {item.group_code || item.cohort_code || "—"}
                      </p>
                      <p className="text-muted-foreground">
                        مكلف: {item.assigned_component_hours} · مجدول:{" "}
                        {item.currently_scheduled_hours} · متبقي: {item.remaining_schedule_hours}
                      </p>
                      {item.blocking_reason ? (
                        <p className="text-destructive">
                          {blockingReasonLabelAr(item.blocking_reason)}
                        </p>
                      ) : null}
                    </div>
                    {mayShowCreateAction ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!mayCreate || !item.can_create_session}
                        onClick={() => setSelected(item)}
                      >
                        إضافة إلى الجدول
                      </Button>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null,
          )}
        </CardContent>
      ) : null}
      {mayShowCreateAction ? (
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
      ) : null}
    </Card>
  );
}
