import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { DAYS } from "@/routes/_authenticated/time-slots";
import {
  DEFAULT_WORKING_DAYS,
  isValidTimeRange,
  resolveWorkingDays,
} from "@/lib/availability/active-days";
import {
  createInstructorSchedulingRequest,
  INSTRUCTOR_REQUEST_KIND_LABEL_AR,
  INSTRUCTOR_REQUEST_STATUS_LABEL_AR,
  listInstructorSchedulingRequests,
  reviewInstructorSchedulingRequest,
  type InstructorSchedulingRequestKind,
} from "@/lib/availability/policy-api";
import { userErrorMessage } from "@/lib/user-error";
import { confirmAction } from "@/components/confirm-dialog";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { readAllRows } from "@/lib/supabase/read-all";
import { formatNumber } from "@/lib/format";
import { useWorkingDays } from "@/components/availability/availability-shared";

/** Instructor scheduling requests tab: submit and review. */
export function InstructorRequests() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [reviewNotes, setReviewNotes] = useState({} as Record<string, string>);
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
    queryKey: ["instructors", active?.id, "availability-picker-active"],
    enabled: !!active,
    queryFn: () =>
      readAllRows<{ id: string; full_name: string }>((from, to) =>
        supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .eq("is_active", true)
          .order("full_name")
          .order("id")
          .range(from, to),
      ),
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
    onError: (error: Error) => toast.error(userErrorMessage(error)),
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
      qc.invalidateQueries({ queryKey: ["instructor-availability-windows", active?.id] });
    },
    onError: (error: Error) => toast.error(userErrorMessage(error)),
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
              <Label htmlFor="availability-f16">المحاضر</Label>
              <Select value={instructorId} onValueChange={setInstructorId}>
                <SelectTrigger id="availability-f16">
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
              <Label htmlFor="availability-f17">نوع الطلب</Label>
              <Select
                value={form.requestKind}
                onValueChange={(value) =>
                  setForm({ ...form, requestKind: value as InstructorSchedulingRequestKind })
                }
              >
                <SelectTrigger id="availability-f17">
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
                  <Label htmlFor="availability-f18">اليوم</Label>
                  <Select
                    value={form.dayValue}
                    onValueChange={(value) => setForm({ ...form, dayValue: value })}
                  >
                    <SelectTrigger id="availability-f18">
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
                  <Label htmlFor="availability-f4">من</Label>
                  <Input
                    id="availability-f4"
                    dir="ltr"
                    type="time"
                    value={form.start_time}
                    onChange={(event) => setForm({ ...form, start_time: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="availability-f5">إلى</Label>
                  <Input
                    id="availability-f5"
                    dir="ltr"
                    type="time"
                    value={form.end_time}
                    onChange={(event) => setForm({ ...form, end_time: event.target.value })}
                  />
                </div>
              </>
            ) : form.requestKind === "daily_limit" ? (
              <div>
                <Label htmlFor="availability-f6">أقصى ساعات يومية</Label>
                <Input
                  id="availability-f6"
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
                  <Label htmlFor="availability-f7">أيام الحضور المستهدفة</Label>
                  <Input
                    id="availability-f7"
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
                  <Label htmlFor="availability-f8">الحد الأعلى لأيام الحضور</Label>
                  <Input
                    id="availability-f8"
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
          <div className="p-4">
            <QueryErrorNotice
              title="تعذر تحميل الطلبات."
              error={requestsQuery.error}
              onRetry={() => void requestsQuery.refetch()}
            />
          </div>
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
                        ? ` · ${formatNumber(request.max_hours_per_day)} ساعات/يوم`
                        : ""}
                      {request.target_attendance_days != null
                        ? ` · ${formatNumber(request.target_attendance_days)}–${formatNumber(request.max_attendance_days)} أيام حضور`
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
                      aria-label={`ملاحظة القرار لطلب ${request.instructor_name}`}
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
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `اعتماد طلب ${request.instructor_name} وتطبيقه؟`,
                          description:
                            "يُطبَّق الطلب على سياسة الجدولة الفعلية للمحاضر فور اعتماده.",
                          confirmLabel: "اعتماد وتطبيق",
                        });
                        if (ok) reviewRequest.mutate({ id: request.id, decision: "approved" });
                      }}
                      disabled={reviewRequest.isPending}
                    >
                      اعتماد وتطبيق
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `رفض طلب ${request.instructor_name}؟`,
                          description: "لا يمكن إعادة فتح الطلب بعد رفضه؛ يلزم تسجيل طلب جديد.",
                          confirmLabel: "رفض",
                          destructive: true,
                        });
                        if (ok) reviewRequest.mutate({ id: request.id, decision: "rejected" });
                      }}
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
