import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DAYS } from "./time-slots";
import { CalendarClock, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/availability")({
  head: () => ({ meta: [{ title: "التوفّر وعدم التوفّر" }] }),
  component: AvailabilityPage,
});

function AvailabilityPage() {
  const { active } = useActiveCollege();
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><CalendarClock className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">التوفّر وعدم التوفّر</h1>
          <p className="text-sm text-muted-foreground">إدارة أوقات توفّر المحاضرين وعدم توفّر القاعات.</p>
        </div>
      </header>

      <div className="mb-4"><CollegeSwitcher /></div>

      {!active ? <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">اختر كلّية أولاً.</p> : (
        <Tabs defaultValue="instructor">
          <TabsList>
            <TabsTrigger value="instructor">توفّر المحاضرين</TabsTrigger>
            <TabsTrigger value="room_avail">توفّر القاعات</TabsTrigger>
            <TabsTrigger value="room">عدم توفّر القاعات</TabsTrigger>
          </TabsList>
          <TabsContent value="instructor" className="mt-4"><InstructorAvailability /></TabsContent>
          <TabsContent value="room_avail" className="mt-4"><RoomAvailability /></TabsContent>
          <TabsContent value="room" className="mt-4"><RoomUnavailability /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

interface IA { id: string; instructor_id: string; day_of_week: number; start_time: string; end_time: string; availability_type: string; is_preference: boolean; notes: string | null }
const AVAIL_TYPES = [{ v: "available", l: "متاح" }, { v: "preferred", l: "مفضّل" }, { v: "unavailable", l: "غير متاح" }];

function InstructorAvailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [form, setForm] = useState({ day_of_week: 0, start_time: "08:00", end_time: "12:00", availability_type: "available", is_preference: false, notes: "" });

  const { data: instructors } = useQuery({
    queryKey: ["instr-all", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("instructors").select("id, full_name").eq("college_id", active!.id).order("full_name")).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["ia", active?.id, instructorId], enabled: !!active && !!instructorId,
    queryFn: async () => {
      const { data, error } = await supabase.from("instructor_availability").select("*")
        .eq("college_id", active!.id).eq("instructor_id", instructorId).order("day_of_week").order("start_time");
      if (error) throw error; return (data ?? []) as IA[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !instructorId) throw new Error("اختر محاضراً");
      if (form.end_time <= form.start_time) throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      const payload = { ...form, day_of_week: Number(form.day_of_week), college_id: active.id, instructor_id: instructorId, notes: form.notes || null };
      const { data, error } = await supabase.from("instructor_availability").insert(payload).select("id").single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "instructor_availability", entityId: data?.id, collegeId: active.id });
    },
    onSuccess: () => { toast.success("تمت الإضافة"); qc.invalidateQueries({ queryKey: ["ia", active?.id, instructorId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("instructor_availability").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "instructor_availability", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["ia", active?.id, instructorId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>المحاضر</Label>
        <Select value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger><SelectValue placeholder="اختر محاضراً" /></SelectTrigger>
          <SelectContent>{(instructors ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {instructorId && canManage && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">إضافة فترة توفّر</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div><Label>اليوم</Label>
              <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>من</Label><Input dir="ltr" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><Label>إلى</Label><Input dir="ltr" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><Label>الحالة</Label>
              <Select value={form.availability_type} onValueChange={(v) => setForm({ ...form, availability_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AVAIL_TYPES.map((a) => <SelectItem key={a.v} value={a.v}>{a.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>النوع</Label>
              <Select value={form.is_preference ? "pref" : "hard"} onValueChange={(v) => setForm({ ...form, is_preference: v === "pref" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hard">إلزامي (Hard)</SelectItem>
                  <SelectItem value="pref">تفضيل (Soft)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">إضافة</Button></div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {!instructorId ? <p className="p-6 text-center text-muted-foreground">اختر محاضراً لعرض فتراته.</p>
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد فترات.</p>
          : <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{DAYS[r.day_of_week]} <span dir="ltr">{r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}</span></p>
                    <p className="text-xs text-muted-foreground">{AVAIL_TYPES.find((a) => a.v === r.availability_type)?.l}</p>
                  </div>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}

interface RU { id: string; room_id: string; day_of_week: number | null; start_time: string | null; end_time: string | null; start_date: string | null; end_date: string | null; reason: string | null }

function RoomUnavailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [roomId, setRoomId] = useState("");
  const [form, setForm] = useState({ day_of_week: "", start_time: "", end_time: "", start_date: "", end_date: "", reason: "" });

  const { data: rooms } = useQuery({
    queryKey: ["rooms-all", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("rooms").select("id, code, name").eq("college_id", active!.id).order("code")).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["ru", active?.id, roomId], enabled: !!active && !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase.from("room_unavailability").select("*")
        .eq("college_id", active!.id).eq("room_id", roomId).order("created_at");
      if (error) throw error; return (data ?? []) as RU[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !roomId) throw new Error("اختر قاعة");
      const payload = {
        college_id: active.id, room_id: roomId,
        day_of_week: form.day_of_week === "" ? null : Number(form.day_of_week),
        start_time: form.start_time || null, end_time: form.end_time || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        reason: form.reason || null,
      };
      const { data, error } = await supabase.from("room_unavailability").insert(payload).select("id").single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "room_unavailability", entityId: data?.id, collegeId: active.id });
    },
    onSuccess: () => { toast.success("تمت الإضافة"); qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("room_unavailability").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "room_unavailability", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>القاعة</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger><SelectValue placeholder="اختر قاعة" /></SelectTrigger>
          <SelectContent>{(rooms ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.code} — {r.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {roomId && canManage && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">إضافة فترة عدم توفّر</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div><Label>اليوم (اختياري)</Label>
              <Select value={form.day_of_week || "_none"} onValueChange={(v) => setForm({ ...form, day_of_week: v === "_none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— غير محدد —</SelectItem>
                  {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>من ساعة</Label><Input dir="ltr" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><Label>إلى ساعة</Label><Input dir="ltr" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><Label>من تاريخ</Label><Input dir="ltr" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>إلى تاريخ</Label><Input dir="ltr" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            <div><Label>السبب</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => add.mutate()} disabled={add.isPending}>إضافة</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {!roomId ? <p className="p-6 text-center text-muted-foreground">اختر قاعة لعرض فتراتها.</p>
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد فترات عدم توفّر.</p>
          : <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {r.day_of_week !== null ? DAYS[r.day_of_week] : "—"}
                      {r.start_time && r.end_time && <span dir="ltr"> · {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}</span>}
                      {(r.start_date || r.end_date) && <span dir="ltr"> · {r.start_date ?? "?"} → {r.end_date ?? "?"}</span>}
                    </p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  </div>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}

interface RA { id: string; room_id: string; day_of_week: number; start_time: string; end_time: string; notes: string | null }

function RoomAvailability() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [roomId, setRoomId] = useState("");
  const [form, setForm] = useState({ day_of_week: 0, start_time: "08:00", end_time: "14:00", notes: "" });

  const { data: rooms } = useQuery({
    queryKey: ["rooms-all2", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("rooms").select("id, code, name").eq("college_id", active!.id).order("code")).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["ra", active?.id, roomId], enabled: !!active && !!roomId,
    queryFn: async () => {
      const { data, error } = await supabase.from("room_availability").select("*")
        .eq("college_id", active!.id).eq("room_id", roomId).order("day_of_week").order("start_time");
      if (error) throw error; return (data ?? []) as RA[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !roomId) throw new Error("اختر قاعة");
      if (form.end_time <= form.start_time) throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      const payload = {
        college_id: active.id, room_id: roomId,
        day_of_week: Number(form.day_of_week),
        start_time: form.start_time, end_time: form.end_time,
        notes: form.notes || null,
      };
      const { data, error } = await supabase.from("room_availability").insert(payload).select("id").single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "room_availability", entityId: data?.id, collegeId: active.id });
    },
    onSuccess: () => { toast.success("تمت الإضافة"); qc.invalidateQueries({ queryKey: ["ra", active?.id, roomId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("room_availability").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "room_availability", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["ra", active?.id, roomId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>القاعة</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger><SelectValue placeholder="اختر قاعة" /></SelectTrigger>
          <SelectContent>{(rooms ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.code} — {r.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {roomId && canManage && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">إضافة فترة توفّر للقاعة</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div><Label>اليوم</Label>
              <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>من</Label><Input dir="ltr" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><Label>إلى</Label><Input dir="ltr" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><Label>ملاحظات</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">إضافة</Button></div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {!roomId ? <p className="p-6 text-center text-muted-foreground">اختر قاعة لعرض فتراتها.</p>
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد فترات. سيتم استخدام إعدادات القاعة الافتراضية.</p>
          : <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{DAYS[r.day_of_week]} <span dir="ltr">{r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}</span></p>
                    {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  </div>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
