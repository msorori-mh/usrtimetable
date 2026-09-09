import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
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
import { CalendarClock, Trash2 } from "lucide-react";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  DEFAULT_WORKING_DAYS,
  formatBulkSuccessMessage,
  groupIdenticalWindows,
  isValidTimeRange,
  resolveWorkingDays,
} from "@/lib/availability/active-days";
import {
  fetchCollegeWorkingDays,
  upsertInstructorUnavailabilityBulk,
  upsertRoomUnavailabilityBulk,
} from "@/lib/availability/bulk-api";
import { readableWriteError } from "@/lib/availability/errors";

export const Route = createFileRoute("/_authenticated/availability")({
  head: () => ({ meta: [{ title: "عدم التوفّر" }] }),
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
      سيتم تطبيق فترة عدم التوفر على {count} {count === 1 ? "يوم" : "أيام"}.
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
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">عدم التوفّر</h1>
          <p className="text-sm text-muted-foreground">
            تسجيل فترات المنع الإلزامية (Hard) للمحاضرين والقاعات. المحاضر والقاعة النشطان متاحان
            افتراضيًا خلال أيام وفترات الدوام.
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
        <Tabs defaultValue="instructor">
          <TabsList>
            <TabsTrigger value="instructor">عدم توفّر المحاضرين</TabsTrigger>
            <TabsTrigger value="room">عدم توفّر القاعات</TabsTrigger>
          </TabsList>
          <TabsContent value="instructor" className="mt-4">
            <InstructorUnavailability />
          </TabsContent>
          <TabsContent value="room" className="mt-4">
            <RoomUnavailability />
          </TabsContent>
        </Tabs>
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
  notes: string | null;
}

function InstructorUnavailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [form, setForm] = useState({
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
        .eq("availability_type", "unavailable")
        .eq("is_preference", false)
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
      return upsertInstructorUnavailabilityBulk({
        collegeId: active.id,
        instructorId,
        startTime: form.start_time,
        endTime: form.end_time,
        notes: form.notes || null,
        dayOfWeek,
      });
    },
    onSuccess: (result) => {
      toast.success(formatBulkSuccessMessage(result));
      qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] });
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
    },
    onError: (e: unknown) => {
      toast.error(readableWriteError(e));
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
          <p className="mb-3 text-sm font-semibold">إضافة فترة عدم توفّر (إلزامي)</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
            <div className="flex items-end">
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
            اختر محاضراً لعرض فترات عدم التوفّر.
          </p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            لا توجد فترات منع. المحاضر متاح افتراضيًا خلال أيام الدوام.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {grouped.map((g) => {
              const r = g.sample;
              const matchingIds = (rows ?? []).filter(
                (x) =>
                  x.start_time.slice(0, 5) === r.start_time.slice(0, 5) &&
                  x.end_time.slice(0, 5) === r.end_time.slice(0, 5) &&
                  (x.notes ?? "") === (r.notes ?? ""),
              );
              return (
                <li
                  key={`${r.start_time}-${r.end_time}-${g.days.join(",")}`}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {g.label}{" "}
                      <span dir="ltr">
                        {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      منع إلزامي (Hard)
                      {g.label === "كل أيام الدوام" ? " · سجلات يومية مستقلة" : ""}
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
                {r.code} — {r.name}
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
