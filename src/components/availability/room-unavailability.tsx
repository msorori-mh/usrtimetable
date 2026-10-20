import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
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
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DAYS } from "@/routes/_authenticated/time-slots";
import { Trash2 } from "lucide-react";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  formatBulkSuccessMessage,
  isValidTimeRange,
} from "@/lib/availability/active-days";
import { upsertRoomUnavailabilityBulk } from "@/lib/availability/bulk-api";
import { readableWriteError } from "@/lib/availability/errors";
import { entityDisplayName } from "@/lib/entity-display";
import { userErrorMessage } from "@/lib/user-error";
import { confirmAction } from "@/components/confirm-dialog";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { formatDate } from "@/lib/format";
import {
  rpcErrorMessage,
  useWorkingDays,
  AffectedDaysPreview,
  DaySelectItems,
} from "@/components/availability/availability-shared";

/** Room unavailability tab. */
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

export function RoomUnavailability() {
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

  const { data: rooms, error: roomsError } = useQuery({
    queryKey: ["rooms", active?.id, "availability-picker"],
    enabled: !!active,
    queryFn: async () => {
      // read-all-ok: rooms per college are bounded (tens to low hundreds)
      const { data, error } = await supabase
        .from("rooms")
        .select("id, code, name")
        .eq("college_id", active!.id)
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });
  const {
    data: rows,
    isLoading: rowsLoading,
    error: rowsError,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ["room-unavailability", active?.id, roomId],
    enabled: !!active && !!roomId,
    queryFn: async () => {
      // read-all-ok: unavailability windows of a single room
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
      qc.invalidateQueries({ queryKey: ["room-unavailability", active?.id, roomId] });
    },
    onError: (e: unknown) => {
      toast.error(rpcErrorMessage(e));
      qc.invalidateQueries({ queryKey: ["room-unavailability", active?.id, roomId] });
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
      qc.invalidateQueries({ queryKey: ["room-unavailability", active?.id, roomId] });
    },
    onError: (e: unknown) => {
      toast.error(userErrorMessage(e));
      qc.invalidateQueries({ queryKey: ["room-unavailability", active?.id, roomId] });
    },
  });

  return (
    <div className="space-y-4">
      {roomsError && <QueryErrorNotice title="تعذّر تحميل قائمة القاعات." error={roomsError} />}
      <div className="max-w-md">
        <Label htmlFor="availability-room">القاعة</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger id="availability-room">
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
              <Label htmlFor="availability-f19">اليوم</Label>
              <Select
                value={form.dayValue}
                onValueChange={(v) => setForm({ ...form, dayValue: v })}
              >
                <SelectTrigger id="availability-f19">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <DaySelectItems workingDays={workingDays} />
                  <SelectItem value="_none">— غير محدد (تاريخ فقط) —</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="availability-f9">من ساعة</Label>
              <Input
                id="availability-f9"
                dir="ltr"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f10">إلى ساعة</Label>
              <Input
                id="availability-f10"
                dir="ltr"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f11">من تاريخ</Label>
              <Input
                id="availability-f11"
                dir="ltr"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f12">إلى تاريخ</Label>
              <Input
                id="availability-f12"
                dir="ltr"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="availability-f13">السبب</Label>
              <Input
                id="availability-f13"
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
        ) : rowsLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل…</p>
        ) : rowsError ? (
          <div className="p-4">
            <QueryErrorNotice error={rowsError} onRetry={() => void refetchRows()} />
          </div>
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
                        · {r.start_date ? formatDate(r.start_date) : "?"} →{" "}
                        {r.end_date ? formatDate(r.end_date) : "?"}
                      </span>
                    )}
                  </p>
                  {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={del.isPending}
                    aria-label={`حذف فترة عدم توفّر ${r.day_of_week !== null ? DAYS[r.day_of_week] : ""}`.trim()}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: "حذف فترة عدم توفّر القاعة؟",
                        description:
                          "تصبح القاعة متاحة للجدولة في هذه الفترة. لا يمكن التراجع عن هذا الإجراء.",
                        confirmLabel: "حذف",
                        destructive: true,
                      });
                      if (ok) del.mutate(r.id);
                    }}
                  >
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
