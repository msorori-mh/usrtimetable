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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  isRoomInUseDeleteError,
  roomDeleteBlockedToastMessage,
} from "@/lib/rooms/room-delete-guard";
import { DoorOpen, Pencil, Trash2 } from "lucide-react";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { roomsExportDataset } from "@/lib/admin-export/datasets";

export const Route = createFileRoute("/_authenticated/rooms")({
  head: () => ({ meta: [{ title: "القاعات والمعامل" }] }),
  component: RoomsPage,
});

interface Room {
  id: string;
  college_id: string;
  code: string;
  name: string;
  room_type: string;
  capacity: number;
  building: string | null;
  floor: string | null;
  is_active: boolean;
  notes: string | null;
}

export const ROOM_TYPES = [
  { v: "lecture_hall", l: "قاعة محاضرات" },
  { v: "computer_lab", l: "معمل حاسوب" },
  { v: "network_lab", l: "معمل شبكات" },
  { v: "cybersecurity_lab", l: "معمل أمن سيبراني" },
  { v: "electronics_lab", l: "معمل إلكترونيات" },
  { v: "workshop", l: "ورشة" },
  { v: "seminar_room", l: "قاعة ندوات" },
];

function emptyForm() {
  return {
    code: "",
    name: "",
    room_type: "lecture_hall",
    capacity: 30,
    building: "",
    floor: "",
    is_active: true,
    notes: "",
  };
}

function RoomsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: rows, isLoading } = useQuery({
    queryKey: ["rooms", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("college_id", active!.id)
        .order("code");
      if (error) throw error;
      return (data ?? []) as Room[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.code.trim() || !form.name.trim()) throw new Error("الرمز والاسم مطلوبان");
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        room_type: form.room_type,
        capacity: Number(form.capacity) || 0,
        building: form.building.trim() || null,
        floor: form.floor.trim() || null,
        is_active: form.is_active,
        college_id: active.id,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("rooms").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "rooms",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase.from("rooms").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "rooms",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["rooms", active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) =>
      toast.error(e.message.includes("duplicate") ? "رمز القاعة مستخدم في هذه الكلّية" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { count, error: countError } = await supabase
        .from("schedule_sessions")
        .select("id", { count: "exact", head: true })
        .eq("room_id", id);
      if (countError) throw countError;
      if ((count ?? 0) > 0) {
        throw new Error(`ROOM_IN_USE:${count}`);
      }
      const { error } = await supabase.from("rooms").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "rooms", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["rooms", active?.id] });
    },
    onError: (e: Error) => {
      const msg = e.message ?? "";
      if (isRoomInUseDeleteError(msg) || msg.startsWith("ROOM_IN_USE:")) {
        toast.error(roomDeleteBlockedToastMessage());
        return;
      }
      toast.error(msg);
    },
  });

  const startEdit = (r: Room) => {
    setEditing(r);
    setForm({
      code: r.code,
      name: r.name,
      room_type: r.room_type,
      capacity: r.capacity,
      building: r.building ?? "",
      floor: r.floor ?? "",
      is_active: r.is_active,
      notes: r.notes ?? "",
    });
    setOpen(true);
  };
  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <DoorOpen className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">القاعات والمعامل</h1>
          <p className="text-sm text-muted-foreground">إدارة قاعات الدراسة والمعامل في الكلّية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate}>قاعة/معمل جديد</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "تعديل القاعة" : "قاعة جديدة"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الرمز</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>الاسم</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>النوع</Label>
                    <Select
                      value={form.room_type}
                      onValueChange={(v) => setForm({ ...form, room_type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOM_TYPES.map((t) => (
                          <SelectItem key={t.v} value={t.v}>
                            {t.l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>السعة</Label>
                    <Input
                      type="number"
                      value={form.capacity}
                      onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>المبنى</Label>
                    <Input
                      value={form.building}
                      onChange={(e) => setForm({ ...form, building: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>الدور</Label>
                    <Input
                      value={form.floor}
                      onChange={(e) => setForm({ ...form, floor: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>ملاحظات</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between rounded border border-border p-3">
                  <Label>نشط</Label>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد قاعات بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">
                    <span dir="ltr">{r.code}</span> — {r.name}{" "}
                    {!r.is_active && (
                      <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[10px]">غير نشط</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROOM_TYPES.find((t) => t.v === r.room_type)?.l} · سعة {r.capacity} ·{" "}
                    {r.building ?? "—"}
                    {r.floor ? ` / دور ${r.floor}` : ""}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          confirm(
                            "حذف القاعة؟ إذا كانت مستخدمة في جلسات دراسية فسيُمنع الحذف؛ عطّل القاعة بدلًا من ذلك.",
                          )
                        )
                          del.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
