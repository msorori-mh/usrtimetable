import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Trash2 } from "lucide-react";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  DEFAULT_WORKING_DAYS,
  groupIdenticalWindows,
  isValidTimeRange,
  resolveWorkingDays,
} from "@/lib/availability/active-days";
import { readableWriteError } from "@/lib/availability/errors";
import {
  INSTRUCTOR_WINDOW_KIND_LABEL_AR,
  upsertInstructorAvailabilityWindows,
  type InstructorWindowKind,
} from "@/lib/availability/policy-api";
import { userErrorMessage } from "@/lib/user-error";
import { confirmAction } from "@/components/confirm-dialog";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { chunkIds, readAllRows } from "@/lib/supabase/read-all";
import { formatNumber } from "@/lib/format";
import {
  rpcErrorMessage,
  useWorkingDays,
  AffectedDaysPreview,
  DaySelectItems,
} from "@/components/availability/availability-shared";

/** Instructor availability windows tab (hard and preference windows). */
interface IU {
  id: string;
  instructor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  availability_type: string;
  is_preference: boolean;
  notes: string | null;
}

function windowKindOf(row: IU): InstructorWindowKind {
  if (row.is_preference) {
    return row.availability_type === "unavailable"
      ? "preferred_unavailable"
      : "preferred_available";
  }
  return row.availability_type === "unavailable" ? "hard_unavailable" : "hard_available";
}

function windowKindTone(kind: InstructorWindowKind): string {
  if (kind === "hard_available")
    return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
  if (kind === "hard_unavailable")
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
  return "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200";
}

export function InstructorUnavailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [form, setForm] = useState({
    windowKind: "hard_unavailable" as InstructorWindowKind,
    dayValue: ALL_ACTIVE_DAYS_SENTINEL,
    start_time: "08:00",
    end_time: "12:00",
    notes: "",
  });
  const { data: workingDays } = useWorkingDays(active?.id);

  const { data: instructors, error: instructorsError } = useQuery({
    queryKey: ["instructors", active?.id, "availability-picker-all"],
    enabled: !!active,
    queryFn: () =>
      readAllRows<{ id: string; full_name: string }>((from, to) =>
        supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .order("full_name")
          .order("id")
          .range(from, to),
      ),
  });
  const {
    data: rows,
    isLoading: rowsLoading,
    error: rowsError,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ["instructor-availability-windows", active?.id, instructorId],
    enabled: !!active && !!instructorId,
    queryFn: async () => {
      const data = await readAllRows<IU>((from, to) =>
        supabase
          .from("instructor_availability")
          .select("*")
          .eq("college_id", active!.id)
          .eq("instructor_id", instructorId)
          .order("day_of_week")
          .order("start_time")
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const grouped = useMemo(
    () =>
      groupIdenticalWindows(rows ?? [], resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS)),
    [rows, workingDays],
  );

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !instructorId) throw new Error("اختر محاضراً");
      if (!isValidTimeRange(form.start_time, form.end_time)) {
        throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      }
      const dayOfWeek = form.dayValue === ALL_ACTIVE_DAYS_SENTINEL ? null : Number(form.dayValue);
      return upsertInstructorAvailabilityWindows({
        collegeId: active.id,
        instructorId,
        windowKind: form.windowKind,
        startTime: form.start_time,
        endTime: form.end_time,
        notes: form.notes || null,
        dayOfWeek,
      });
    },
    onSuccess: (result) => {
      toast.success(
        result.days_created === 0
          ? `لا تغيير: النوافذ موجودة مسبقًا في ${result.days_unchanged} يومًا.`
          : `تم إنشاء النافذة في ${result.days_created} يومًا${result.days_unchanged ? ` · موجودة مسبقًا في ${result.days_unchanged}` : ""}.`,
      );
      qc.invalidateQueries({
        queryKey: ["instructor-availability-windows", active?.id, instructorId],
      });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (e: unknown) => {
      toast.error(rpcErrorMessage(e));
      // Never leave the list showing a stale optimistic state after a failed write.
      qc.invalidateQueries({
        queryKey: ["instructor-availability-windows", active?.id, instructorId],
      });
    },
  });

  const del = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!active) throw new Error("اختر كلّية أولاً.");
      // M-15: one grouped window is removed with set-based deletes (chunked for the URL),
      // never a per-row loop that can stop half-way. Explicit college scoping (defence in
      // depth on top of RLS) + verified row count, so a blocked delete cannot report success.
      const deleted: string[] = [];
      for (const chunk of chunkIds(ids)) {
        const { data, error } = await supabase
          .from("instructor_availability")
          .delete()
          .in("id", chunk)
          .eq("college_id", active.id)
          .select("id");
        if (error) throw new Error(readableWriteError(error));
        deleted.push(...(data ?? []).map((row: { id: string }) => row.id));
      }
      if (deleted.length === 0) {
        throw new Error("لم يُحذف أي سجل: تحقّق من الصلاحية أو أن السجل ما زال موجوداً.");
      }
      await Promise.all(
        deleted.map((id) =>
          logAudit({
            action: "delete",
            entity: "instructor_unavailability",
            entityId: id,
            collegeId: active.id,
          }),
        ),
      );
      if (deleted.length < ids.length) {
        throw new Error(
          `حُذف ${formatNumber(deleted.length)} من ${formatNumber(ids.length)} سجلًا فقط؛ حدّث الصفحة وراجع الصلاحية.`,
        );
      }
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({
        queryKey: ["instructor-availability-windows", active?.id, instructorId],
      });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (e: unknown) => {
      const message = readableWriteError(e);
      toast.error(
        message.includes("AVAILABILITY_REQUIRED_WHILE_ENFORCED")
          ? "لا يمكن حذف آخر نافذة توفر إلزامية لمحاضر خارجي والقيد مفعّل. عطّل القيد أولًا أو أضف نافذة بديلة."
          : userErrorMessage(e),
      );
      qc.invalidateQueries({
        queryKey: ["instructor-availability-windows", active?.id, instructorId],
      });
    },
  });

  return (
    <div className="space-y-4">
      {instructorsError && (
        <QueryErrorNotice title="تعذّر تحميل قائمة المحاضرين." error={instructorsError} />
      )}
      <div className="max-w-md">
        <Label htmlFor="availability-instructor">المحاضر</Label>
        <Select value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger id="availability-instructor">
            <SelectValue placeholder="اختر محاضراً" />
          </SelectTrigger>
          <SelectContent>
            {(instructors ?? []).map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {instructorId && canManage && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">إضافة نافذة إتاحة أو تفضيل</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="availability-f14">نوع النافذة</Label>
              <Select
                value={form.windowKind}
                onValueChange={(value) =>
                  setForm({ ...form, windowKind: value as InstructorWindowKind })
                }
              >
                <SelectTrigger id="availability-f14">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INSTRUCTOR_WINDOW_KIND_LABEL_AR).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <Label htmlFor="availability-f15">اليوم</Label>
              <Select
                value={form.dayValue}
                onValueChange={(v) => setForm({ ...form, dayValue: v })}
              >
                <SelectTrigger id="availability-f15">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <DaySelectItems workingDays={workingDays} />
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="availability-f1">من</Label>
              <Input
                id="availability-f1"
                dir="ltr"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f2">إلى</Label>
              <Input
                id="availability-f2"
                dir="ltr"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f3">ملاحظات</Label>
              <Input
                id="availability-f3"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="col-span-2 flex items-end md:col-span-1">
              <Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">
                إضافة
              </Button>
            </div>
          </div>
          <AffectedDaysPreview dayValue={form.dayValue} workingDays={workingDays} />
        </Card>
      )}

      <Card className="overflow-hidden">
        {!instructorId ? (
          <p className="p-6 text-center text-muted-foreground">
            اختر محاضراً لعرض نوافذ الإتاحة والتفضيلات.
          </p>
        ) : rowsLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل…</p>
        ) : rowsError ? (
          <div className="p-4">
            <QueryErrorNotice error={rowsError} onRetry={() => void refetchRows()} />
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            لا توجد نوافذ مسجلة. المحاضر الدائم متاح افتراضيًا، أما الخارجي فيلزم له توفر صريح قبل
            تفعيل القيد.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {grouped.map((g) => {
              const r = g.sample;
              const kind = windowKindOf(r);
              const matchingIds = (rows ?? []).filter(
                (x) =>
                  x.start_time.slice(0, 5) === r.start_time.slice(0, 5) &&
                  x.end_time.slice(0, 5) === r.end_time.slice(0, 5) &&
                  x.availability_type === r.availability_type &&
                  x.is_preference === r.is_preference &&
                  (x.notes ?? "") === (r.notes ?? ""),
              );
              return (
                <li
                  key={`${r.start_time}-${r.end_time}-${g.days.join(",")}`}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <Badge variant="outline" className={windowKindTone(kind)}>
                        {INSTRUCTOR_WINDOW_KIND_LABEL_AR[kind]}
                      </Badge>
                      <span>{g.label}</span>{" "}
                      <span dir="ltr">
                        {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {g.label === "كل أيام الدوام" ? "سجلات يومية مستقلة" : ""}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={del.isPending}
                      aria-label={`حذف نافذة ${INSTRUCTOR_WINDOW_KIND_LABEL_AR[kind]} ${g.label} ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`}
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `حذف نافذة «${INSTRUCTOR_WINDOW_KIND_LABEL_AR[kind]}» (${g.label} ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)})؟`,
                          description:
                            matchingIds.length > 1
                              ? `ستُحذف ${formatNumber(matchingIds.length)} سجلات يومية معًا. لا يمكن التراجع عن هذا الإجراء.`
                              : "لا يمكن التراجع عن هذا الإجراء.",
                          confirmLabel: "حذف",
                          destructive: true,
                        });
                        if (ok) del.mutate(matchingIds.map((row) => row.id));
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
