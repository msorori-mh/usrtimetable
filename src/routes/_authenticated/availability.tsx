import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DAYS } from "./time-slots";
import { AlertTriangle, CalendarClock, ShieldCheck, Trash2 } from "lucide-react";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  DEFAULT_WORKING_DAYS,
  formatBulkSuccessMessage,
  groupIdenticalWindows,
  isValidTimeRange,
  resolveWorkingDays,
} from "@/lib/availability/active-days";
import { fetchCollegeWorkingDays, upsertRoomUnavailabilityBulk } from "@/lib/availability/bulk-api";
import { readableWriteError } from "@/lib/availability/errors";
import { entityDisplayName } from "@/lib/entity-display";
import {
  createInstructorSchedulingRequest,
  fetchInstructorAvailabilityReadiness,
  INSTRUCTOR_REQUEST_KIND_LABEL_AR,
  INSTRUCTOR_REQUEST_STATUS_LABEL_AR,
  INSTRUCTOR_WINDOW_KIND_LABEL_AR,
  listInstructorSchedulingRequests,
  reviewInstructorSchedulingRequest,
  upsertInstructorAvailabilityWindows,
  type InstructorSchedulingRequestKind,
  type InstructorWindowKind,
} from "@/lib/availability/policy-api";

export const Route = createFileRoute("/_authenticated/availability")({
  head: () => ({ meta: [{ title: "إتاحة الموارد وطلبات المحاضرين" }] }),
  component: AvailabilityPage,
});

function rpcErrorMessage(e: unknown): string {
  // LAUNCH-CLOSURE-01: the previous shape stringified any non-Error rejection, which renders
  // as the literal "[object Object]", and for a real PostgrestError it printed only `message`
  // and dropped `hint` and `details` — yet PostgREST puts the actionable cause in `hint`.
  // `readableWriteError` keeps all three and can never produce "[object Object]".
  const msg = readableWriteError(e);
  const overlap =
    msg.match(/availability_overlap:\s*day=(\d+)/i) ??
    msg.match(/unavailability_overlap:\s*day=(\d+)/i);
  if (overlap) {
    const day = Number(overlap[1]);
    const dayLabel = DAYS[day] ?? `اليوم ${day}`;
    return `تعارض في ${dayLabel}: تم رفض العملية بالكامل (لا تطبيق جزئي). ${msg}`;
  }
  if (/invalid_time_range/i.test(msg)) {
    return "وقت النهاية يجب أن يكون بعد البداية.";
  }
  if (/college access denied|42501/i.test(msg)) {
    return "ليس لديك صلاحية لإدارة هذه الكلية.";
  }
  if (/authentication required/i.test(msg)) {
    return "يجب تسجيل الدخول أولاً.";
  }
  return msg;
}

function useWorkingDays(collegeId: string | undefined) {
  return useQuery({
    queryKey: ["scheduling-working-days", collegeId],
    enabled: !!collegeId,
    queryFn: () => fetchCollegeWorkingDays(collegeId!),
    staleTime: 60_000,
  });
}

function AffectedDaysPreview({
  dayValue,
  workingDays,
}: {
  dayValue: string;
  workingDays: number[] | undefined;
}) {
  const days = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);
  const count = dayValue === ALL_ACTIVE_DAYS_SENTINEL ? days.length : 1;
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="affected-days-preview">
      سيتم تطبيق الفترة على {count} {count === 1 ? "يوم" : "أيام"}.
    </p>
  );
}

/** Day options from operational calendar (scheduling_settings.working_days) — never hardcoded week. */
function DaySelectItems({ workingDays }: { workingDays: number[] | undefined }) {
  const activeDays = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);
  return (
    <>
      <SelectItem value={ALL_ACTIVE_DAYS_SENTINEL}>كل أيام الدوام</SelectItem>
      {activeDays.map((day) => (
        <SelectItem key={day} value={String(day)}>
          {DAYS[day] ?? `اليوم ${day}`}
        </SelectItem>
      ))}
    </>
  );
}

function AvailabilityPage() {
  const { active } = useActiveCollege();
  const {
    data: readiness,
    isLoading: availabilityPolicyLoading,
    isError: availabilityPolicyError,
  } = useQuery({
    queryKey: ["instructor-availability-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchInstructorAvailabilityReadiness(active!.id),
  });
  const instructorAvailabilityEnabled = readiness?.enabled === true;
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">إتاحة الموارد وطلبات المحاضرين</h1>
          <p className="text-sm text-muted-foreground">
            إدارة نوافذ التوفر والمنع الإلزامية، والتفضيلات، وطلبات العبء والحضور قبل الجدولة.
          </p>
        </div>
      </header>

      <div className="mb-4">
        <CollegeSwitcher />
      </div>

      {!active ? (
        <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          اختر كلّية أولاً.
        </p>
      ) : (
        <div className="space-y-4">
          <Card
            className={`flex flex-col gap-3 border p-4 sm:flex-row sm:items-center sm:justify-between ${
              availabilityPolicyError
                ? "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20"
                : instructorAvailabilityEnabled
                  ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
            }`}
          >
            <div className="flex items-start gap-3">
              {!availabilityPolicyError && instructorAvailabilityEnabled ? (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 h-5 w-5 shrink-0 ${availabilityPolicyError ? "text-red-700" : "text-amber-700"}`}
                />
              )}
              <div>
                <p className="font-semibold">
                  {availabilityPolicyLoading
                    ? "جارٍ التحقق من حالة القيد..."
                    : availabilityPolicyError
                      ? "تعذر التحقق من حالة تطبيق القيد"
                      : instructorAvailabilityEnabled
                        ? "إتاحة المحاضرين مطبّقة على الجدولة"
                        : "إتاحة المحاضرين محفوظة ولكن غير مطبّقة"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {availabilityPolicyError
                    ? "لا تعتمد على حالة الإتاحة قبل إعادة المحاولة؛ لم تُفترض قيمة بديلة عند فشل قراءة الإعداد."
                    : instructorAvailabilityEnabled
                      ? `تطبق القيود في المولّد والتحقق والحفظ. نوافذ إلزامية: ${readiness?.hard_windows ?? 0} · تفضيلات: ${readiness?.preference_windows ?? 0}.`
                      : `يمكن تجهيز النوافذ والطلبات الآن. المتبقي قبل التفعيل: ${readiness?.missing_required_instructors ?? 0} محاضر خارجي بلا توفر صريح.`}
                </p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link to="/scheduling-settings">إدارة التفعيل</Link>
            </Button>
          </Card>

          <Tabs defaultValue="instructor">
            <TabsList>
              <TabsTrigger value="instructor">إتاحة المحاضرين</TabsTrigger>
              <TabsTrigger value="requests">
                الطلبات{readiness?.pending_requests ? ` (${readiness.pending_requests})` : ""}
              </TabsTrigger>
              <TabsTrigger value="room">عدم توفّر القاعات</TabsTrigger>
            </TabsList>
            <TabsContent value="instructor" className="mt-4">
              <InstructorUnavailability />
            </TabsContent>
            <TabsContent value="requests" className="mt-4">
              <InstructorRequests />
            </TabsContent>
            <TabsContent value="room" className="mt-4">
              <RoomUnavailability />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

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

function InstructorUnavailability() {
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

  const { data: instructors } = useQuery({
    queryKey: ["instr-all", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .order("full_name")
      ).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["iu", active?.id, instructorId],
    enabled: !!active && !!instructorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructor_availability")
        .select("*")
        .eq("college_id", active!.id)
        .eq("instructor_id", instructorId)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as IU[];
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
      qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (e: unknown) => {
      toast.error(rpcErrorMessage(e));
      // Never leave the list showing a stale optimistic state after a failed write.
      qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (!active) throw new Error("اختر كلّية أولاً.");
      // Explicit college scoping (defence in depth on top of RLS) + verified row count,
      // so a blocked delete cannot report success.
      const { data, error } = await supabase
        .from("instructor_availability")
        .delete()
        .eq("id", id)
        .eq("college_id", active.id)
        .select("id");
      if (error) throw new Error(readableWriteError(error));
      if (!data || data.length === 0) {
        throw new Error("لم يُحذف أي سجل: تحقّق من الصلاحية أو أن السجل ما زال موجوداً.");
      }
      await logAudit({
        action: "delete",
        entity: "instructor_unavailability",
        entityId: id,
        collegeId: active.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (e: unknown) => {
      const message = readableWriteError(e);
      toast.error(
        message.includes("AVAILABILITY_REQUIRED_WHILE_ENFORCED")
          ? "لا يمكن حذف آخر نافذة توفر إلزامية لمحاضر خارجي والقيد مفعّل. عطّل القيد أولًا أو أضف نافذة بديلة."
          : message,
      );
      qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>المحاضر</Label>
        <Select value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger>
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
              <Label>نوع النافذة</Label>
              <Select
                value={form.windowKind}
                onValueChange={(value) =>
                  setForm({ ...form, windowKind: value as InstructorWindowKind })
                }
              >
                <SelectTrigger>
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
              <Label>اليوم</Label>
              <Select
                value={form.dayValue}
                onValueChange={(v) => setForm({ ...form, dayValue: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <DaySelectItems workingDays={workingDays} />
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>من</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label>إلى</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Input
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
                      onClick={() => {
                        void (async () => {
                          for (const row of matchingIds) {
                            await del.mutateAsync(row.id);
                          }
                        })();
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

function InstructorRequests() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    requestKind: "hard_available" as InstructorSchedulingRequestKind,
    dayValue: "6",
    start_time: "08:00",
    end_time: "12:00",
    max_hours_per_day: 6,
    target_attendance_days: 3,
    max_attendance_days: 4,
    reason: "",
  });
  const { data: workingDays } = useWorkingDays(active?.id);

  useEffect(() => {
    const days = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);
    if (!days.includes(Number(form.dayValue)) && days[0] != null) {
      setForm((current) => ({ ...current, dayValue: String(days[0]) }));
    }
  }, [workingDays, form.dayValue]);

  const instructorsQuery = useQuery({
    queryKey: ["instr-all", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select("id, full_name")
        .eq("college_id", active!.id)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["instructor-scheduling-requests", active?.id],
    enabled: !!active,
    queryFn: () => listInstructorSchedulingRequests(active!.id),
  });

  const createRequest = useMutation({
    mutationFn: async () => {
      if (!active || !instructorId) throw new Error("اختر محاضرًا");
      const isWindow = form.requestKind.includes("available");
      if (isWindow && !isValidTimeRange(form.start_time, form.end_time)) {
        throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      }
      if (
        form.requestKind === "attendance_days" &&
        form.target_attendance_days > form.max_attendance_days
      ) {
        throw new Error("أيام الحضور المستهدفة يجب ألا تتجاوز الحد الأعلى.");
      }
      if (
        form.requestKind === "daily_limit" &&
        (form.max_hours_per_day < 1 || form.max_hours_per_day > 12)
      ) {
        throw new Error("سقف الساعات اليومية يجب أن يكون بين 1 و12.");
      }
      if (
        form.requestKind === "attendance_days" &&
        (form.target_attendance_days < 1 ||
          form.max_attendance_days > 6 ||
          form.max_attendance_days < 1)
      ) {
        throw new Error("أيام الحضور يجب أن تكون بين 1 و6.");
      }
      await createInstructorSchedulingRequest({
        collegeId: active.id,
        instructorId,
        requestKind: form.requestKind,
        dayOfWeek: isWindow ? Number(form.dayValue) : null,
        startTime: isWindow ? form.start_time : null,
        endTime: isWindow ? form.end_time : null,
        maxHoursPerDay: form.requestKind === "daily_limit" ? form.max_hours_per_day : null,
        targetAttendanceDays:
          form.requestKind === "attendance_days" ? form.target_attendance_days : null,
        maxAttendanceDays: form.requestKind === "attendance_days" ? form.max_attendance_days : null,
        reason: form.reason,
      });
    },
    onSuccess: () => {
      toast.success("تم تسجيل الطلب وإرساله للمراجعة");
      setForm((current) => ({ ...current, reason: "" }));
      qc.invalidateQueries({ queryKey: ["instructor-scheduling-requests", active?.id] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewRequest = useMutation({
    mutationFn: async (input: { id: string; decision: "approved" | "rejected" }) => {
      await reviewInstructorSchedulingRequest({
        requestId: input.id,
        decision: input.decision,
        reviewNote: reviewNotes[input.id] ?? "",
      });
    },
    onSuccess: (_data, input) => {
      toast.success(input.decision === "approved" ? "تم اعتماد الطلب وتطبيقه" : "تم رفض الطلب");
      qc.invalidateQueries({ queryKey: ["instructor-scheduling-requests", active?.id] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
      qc.invalidateQueries({ queryKey: ["iu", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isWindowRequest = form.requestKind.includes("available");

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">تسجيل طلب للمحاضر</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              لا يغيّر الطلب قواعد الجدولة إلا بعد اعتماده؛ يسجل النظام مقدم الطلب والمراجع.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>المحاضر</Label>
              <Select value={instructorId} onValueChange={setInstructorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر محاضرًا" />
                </SelectTrigger>
                <SelectContent>
                  {(instructorsQuery.data ?? []).map((instructor) => (
                    <SelectItem key={instructor.id} value={instructor.id}>
                      {instructor.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع الطلب</Label>
              <Select
                value={form.requestKind}
                onValueChange={(value) =>
                  setForm({ ...form, requestKind: value as InstructorSchedulingRequestKind })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INSTRUCTOR_REQUEST_KIND_LABEL_AR).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isWindowRequest ? (
              <>
                <div>
                  <Label>اليوم</Label>
                  <Select
                    value={form.dayValue}
                    onValueChange={(value) => setForm({ ...form, dayValue: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS).map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {DAYS[day] ?? `اليوم ${day}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>من</Label>
                  <Input
                    dir="ltr"
                    type="time"
                    value={form.start_time}
                    onChange={(event) => setForm({ ...form, start_time: event.target.value })}
                  />
                </div>
                <div>
                  <Label>إلى</Label>
                  <Input
                    dir="ltr"
                    type="time"
                    value={form.end_time}
                    onChange={(event) => setForm({ ...form, end_time: event.target.value })}
                  />
                </div>
              </>
            ) : form.requestKind === "daily_limit" ? (
              <div>
                <Label>أقصى ساعات يومية</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={form.max_hours_per_day}
                  onChange={(event) =>
                    setForm({ ...form, max_hours_per_day: Number(event.target.value) })
                  }
                />
              </div>
            ) : (
              <>
                <div>
                  <Label>أيام الحضور المستهدفة</Label>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={form.target_attendance_days}
                    onChange={(event) =>
                      setForm({ ...form, target_attendance_days: Number(event.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>الحد الأعلى لأيام الحضور</Label>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={form.max_attendance_days}
                    onChange={(event) =>
                      setForm({ ...form, max_attendance_days: Number(event.target.value) })
                    }
                  />
                </div>
              </>
            )}
            <div className="sm:col-span-2 lg:col-span-3">
              <Label>سبب الطلب</Label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                  placeholder="مرجع أو سبب واضح للطلب"
                />
                <Button
                  type="button"
                  onClick={() => createRequest.mutate()}
                  disabled={createRequest.isPending}
                  className="shrink-0"
                >
                  إرسال للمراجعة
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b p-4">
          <h2 className="font-semibold">سجل الطلبات</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            الطلب المعتمد فقط ينتقل إلى سياسة الجدولة الفعلية.
          </p>
        </div>
        {requestsQuery.isLoading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : requestsQuery.isError ? (
          <p className="p-6 text-center text-sm text-destructive">تعذر تحميل الطلبات.</p>
        ) : !requestsQuery.data?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">لا توجد طلبات مسجلة.</p>
        ) : (
          <ul className="divide-y">
            {requestsQuery.data.map((request) => (
              <li key={request.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">{request.instructor_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {INSTRUCTOR_REQUEST_KIND_LABEL_AR[request.request_kind]}
                      {request.day_of_week != null ? ` · ${DAYS[request.day_of_week]}` : ""}
                      {request.start_time && request.end_time
                        ? ` · ${request.start_time.slice(0, 5)}–${request.end_time.slice(0, 5)}`
                        : ""}
                      {request.max_hours_per_day != null
                        ? ` · ${request.max_hours_per_day} ساعات/يوم`
                        : ""}
                      {request.target_attendance_days != null
                        ? ` · ${request.target_attendance_days}–${request.max_attendance_days} أيام حضور`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm">{request.reason}</p>
                    {request.review_note ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        قرار المراجع: {request.review_note}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={request.status === "submitted" ? "outline" : "secondary"}>
                    {INSTRUCTOR_REQUEST_STATUS_LABEL_AR[request.status]}
                  </Badge>
                </div>
                {canManage && request.status === "submitted" ? (
                  <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row">
                    <Input
                      value={reviewNotes[request.id] ?? ""}
                      onChange={(event) =>
                        setReviewNotes((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      placeholder="ملاحظة قرار الاعتماد أو الرفض"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => reviewRequest.mutate({ id: request.id, decision: "approved" })}
                      disabled={reviewRequest.isPending}
                    >
                      اعتماد وتطبيق
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => reviewRequest.mutate({ id: request.id, decision: "rejected" })}
                      disabled={reviewRequest.isPending}
                    >
                      رفض
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface RU {
  id: string;
  room_id: string;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
}

function RoomUnavailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [roomId, setRoomId] = useState("");
  const [form, setForm] = useState({
    dayValue: ALL_ACTIVE_DAYS_SENTINEL,
    start_time: "08:00",
    end_time: "12:00",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const { data: workingDays } = useWorkingDays(active?.id);

  const { data: rooms } = useQuery({
    queryKey: ["rooms-all", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, code, name")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["ru", active?.id, roomId],
    enabled: !!active && !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_unavailability")
        .select("*")
        .eq("college_id", active!.id)
        .eq("room_id", roomId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as RU[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !roomId) throw new Error("اختر قاعة");
      // Date-only / no-day path (not bulk active days)
      if (form.dayValue === "_none") {
        const payload = {
          college_id: active.id,
          room_id: roomId,
          day_of_week: null as number | null,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          reason: form.reason || null,
        };
        const { data, error } = await supabase
          .from("room_unavailability")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw new Error(readableWriteError(error));
        await logAudit({
          action: "create",
          entity: "room_unavailability",
          entityId: data?.id,
          collegeId: active.id,
        });
        return { status: "ok", days_created: 1, days_unchanged: 0, days_targeted: [] as number[] };
      }
      if (!isValidTimeRange(form.start_time, form.end_time)) {
        throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      }
      const dayOfWeek = form.dayValue === ALL_ACTIVE_DAYS_SENTINEL ? null : Number(form.dayValue);
      return upsertRoomUnavailabilityBulk({
        collegeId: active.id,
        roomId,
        startTime: form.start_time,
        endTime: form.end_time,
        reason: form.reason || null,
        startDate: form.start_date || null,
        endDate: form.end_date || null,
        dayOfWeek,
      });
    },
    onSuccess: (result) => {
      toast.success(formatBulkSuccessMessage(result));
      qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] });
    },
    onError: (e: unknown) => {
      toast.error(rpcErrorMessage(e));
      qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (!active) throw new Error("اختر كلّية أولاً.");
      const { data, error } = await supabase
        .from("room_unavailability")
        .delete()
        .eq("id", id)
        .eq("college_id", active.id)
        .select("id");
      if (error) throw new Error(readableWriteError(error));
      if (!data || data.length === 0) {
        throw new Error("لم يُحذف أي سجل: تحقّق من الصلاحية أو أن السجل ما زال موجوداً.");
      }
      await logAudit({
        action: "delete",
        entity: "room_unavailability",
        entityId: id,
        collegeId: active.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] });
    },
    onError: (e: unknown) => {
      toast.error(readableWriteError(e));
      qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>القاعة</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger>
            <SelectValue placeholder="اختر قاعة" />
          </SelectTrigger>
          <SelectContent>
            {(rooms ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {entityDisplayName(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {roomId && canManage && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">إضافة فترة عدم توفّر للقاعة (إلزامي)</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <Label>اليوم</Label>
              <Select
                value={form.dayValue}
                onValueChange={(v) => setForm({ ...form, dayValue: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <DaySelectItems workingDays={workingDays} />
                  <SelectItem value="_none">— غير محدد (تاريخ فقط) —</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>من ساعة</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label>إلى ساعة</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label>من تاريخ</Label>
              <Input
                dir="ltr"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>إلى تاريخ</Label>
              <Input
                dir="ltr"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
            <div>
              <Label>السبب</Label>
              <Input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
          </div>
          {form.dayValue !== "_none" && (
            <AffectedDaysPreview dayValue={form.dayValue} workingDays={workingDays} />
          )}
          <div className="mt-3 flex justify-end">
            <Button onClick={() => add.mutate()} disabled={add.isPending}>
              إضافة
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {!roomId ? (
          <p className="p-6 text-center text-muted-foreground">اختر قاعة لعرض فترات عدم التوفّر.</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            لا توجد فترات منع. القاعة متاحة افتراضيًا خلال أيام الدوام.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.day_of_week !== null ? DAYS[r.day_of_week] : "—"}
                    {r.start_time && r.end_time && (
                      <span dir="ltr">
                        {" "}
                        · {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}
                      </span>
                    )}
                    {(r.start_date || r.end_date) && (
                      <span dir="ltr">
                        {" "}
                        · {r.start_date ?? "?"} → {r.end_date ?? "?"}
                      </span>
                    )}
                  </p>
                  {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
