import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { validateProposed, type Conflict } from "@/lib/conflict-engine/validator";
import { AlertTriangle, Trash2, Lock, Unlock } from "lucide-react";

const toMin = (s: string) => { const [h, m] = s.slice(0,5).split(":").map(Number); return h * 60 + m; };
const addMin = (s: string, add: number) => {
  const total = toMin(s) + add;
  const h = Math.floor(total / 60) % 24, m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

interface Props {

  open: boolean;
  onOpenChange: (b: boolean) => void;
  collegeId: string;
  scheduleVersionId: string;
  sessionId?: string | null;
  defaults?: Partial<FormState>;
}

interface FormState {
  course_offering_id: string;
  teaching_assignment_id: string | null;
  instructor_id: string;
  room_id: string | null;
  section_id: string | null;
  section_group_id: string | null;
  study_system: "regular" | "parallel" | "both";
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  expected_students: number;
  is_locked: boolean;
  lock_reason: string | null;
  source_type: "manual" | "auto_generated" | "cloned";
}

const empty: FormState = {
  course_offering_id: "", teaching_assignment_id: null, instructor_id: "",
  room_id: null, section_id: null, section_group_id: null,
  study_system: "regular", day_of_week: 0, start_time: "08:00", end_time: "10:00",
  session_type: "lecture", expected_students: 0,
  is_locked: false, lock_reason: null, source_type: "manual",
};

export function SessionDialog({ open, onOpenChange, collegeId, scheduleVersionId, sessionId, defaults }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({ ...empty, ...(defaults ?? {}) });
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [validating, setValidating] = useState(false);

  const { data: offerings } = useQuery({
    queryKey: ["co-for-sched", collegeId],
    queryFn: async () => {
      const { data } = await supabase.from("course_offerings")
        .select("id, course_id, expected_students, courses(code, name)")
        .eq("college_id", collegeId).limit(500);
      return data ?? [];
    },
  });
  const { data: instructors } = useQuery({
    queryKey: ["inst-for-sched", collegeId],
    queryFn: async () => {
      const { data } = await supabase.from("instructors")
        .select("id, full_name").eq("college_id", collegeId).limit(500);
      return data ?? [];
    },
  });
  const { data: rooms } = useQuery({
    queryKey: ["rooms-for-sched", collegeId],
    queryFn: async () => {
      const { data } = await supabase.from("rooms").select("id, code, name, capacity").eq("college_id", collegeId).limit(500);
      return data ?? [];
    },
  });
  const { data: sections } = useQuery({
    queryKey: ["sec-for-sched", collegeId],
    queryFn: async () => {
      const { data } = await supabase.from("sections").select("id, section_number, study_system").eq("college_id", collegeId).limit(500);
      return data ?? [];
    },
  });
  const { data: tas } = useQuery({
    queryKey: ["ta-for-sched", collegeId],
    queryFn: async () => {
      const { data } = await supabase.from("teaching_assignments")
        .select("id, course_offering_id, instructor_id").eq("college_id", collegeId).limit(1000);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (sessionId) {
      supabase.from("schedule_sessions").select("*").eq("id", sessionId).single()
        .then(({ data }) => { if (data) setForm({ ...empty, ...data } as FormState); });
    } else {
      setForm({ ...empty, ...(defaults ?? {}) });
      setConflicts([]);
    }
  }, [open, sessionId]);

  const runValidate = async (): Promise<Conflict[]> => {
    setValidating(true);
    try {
      const res = await validateProposed({
        collegeId, scheduleVersionId,
        sessions: [{ id: sessionId ?? undefined, ...form } as any],
        excludeExistingSessionIds: sessionId ? [sessionId] : [],
      });
      setConflicts(res);
      return res;
    } finally { setValidating(false); }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.course_offering_id || !form.instructor_id) throw new Error("المقرر والمحاضر مطلوبان");
      const res = await runValidate();
      if (res.length > 0) {
        toast.error(`⚠️ يوجد ${res.length} تعارض إلزامي — لا يمكن الحفظ`);
        await logAudit({ action: "blocked_conflict", entity: "schedule_sessions", entityId: sessionId ?? null, collegeId, details: { codes: res.map(r => r.code) } });
        throw new Error("لا يمكن الحفظ — توجد تعارضات إلزامية");
      }
      const payload = { ...form, college_id: collegeId, schedule_version_id: scheduleVersionId };
      if (sessionId) {
        const { error } = await supabase.from("schedule_sessions").update(payload).eq("id", sessionId);
        if (error) throw error;
        await logAudit({ action: "update", entity: "schedule_sessions", entityId: sessionId, collegeId, details: { day_of_week: form.day_of_week } });
      } else {
        const { data, error } = await supabase.from("schedule_sessions").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "schedule_sessions", entityId: data.id, collegeId, details: { day_of_week: form.day_of_week } });
      }
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["sessions-for-version", scheduleVersionId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!sessionId) return;
      const { error } = await supabase.from("schedule_sessions").delete().eq("id", sessionId);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "schedule_sessions", entityId: sessionId, collegeId });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["sessions-for-version", scheduleVersionId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filteredTAs = (tas ?? []).filter((t) => !form.course_offering_id || t.course_offering_id === form.course_offering_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>{sessionId ? "تعديل محاضرة" : "إضافة محاضرة"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>المقرر (Course Offering)</Label>
            <Select value={form.course_offering_id} onValueChange={(v) => setForm({ ...form, course_offering_id: v })}>
              <SelectTrigger><SelectValue placeholder="اختر المقرر" /></SelectTrigger>
              <SelectContent>
                {(offerings ?? []).map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>{o.courses?.code} — {o.courses?.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الإسناد التدريسي</Label>
            <Select value={form.teaching_assignment_id ?? "none"} onValueChange={(v) => setForm({ ...form, teaching_assignment_id: v === "none" ? null : v, instructor_id: v === "none" ? form.instructor_id : (tas?.find(t => t.id === v)?.instructor_id ?? form.instructor_id) })}>
              <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                {filteredTAs.map((t: any) => {
                  const ins = instructors?.find(i => i.id === t.instructor_id);
                  return <SelectItem key={t.id} value={t.id}>{ins?.full_name ?? t.id.slice(0, 6)}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>المحاضر</Label>
            <Select value={form.instructor_id} onValueChange={(v) => setForm({ ...form, instructor_id: v })}>
              <SelectTrigger><SelectValue placeholder="اختر المحاضر" /></SelectTrigger>
              <SelectContent>
                {(instructors ?? []).map((i: any) => (
                  <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>القاعة</Label>
            <Select value={form.room_id ?? "none"} onValueChange={(v) => setForm({ ...form, room_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                {(rooms ?? []).map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>{r.code} — {r.name} (سعة {r.capacity})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>المجموعة</Label>
            <Select value={form.section_id ?? "none"} onValueChange={(v) => setForm({ ...form, section_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                {(sections ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.section_number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>نظام الدراسة</Label>
            <Select value={form.study_system} onValueChange={(v) => setForm({ ...form, study_system: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">الإثنين</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>اليوم</Label>
            <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">السبت</SelectItem>
                <SelectItem value="0">الأحد</SelectItem>
                <SelectItem value="1">الإثنين</SelectItem>
                <SelectItem value="2">الثلاثاء</SelectItem>
                <SelectItem value="3">الأربعاء</SelectItem>
                <SelectItem value="4">الخميس</SelectItem>
                <SelectItem value="5">الجمعة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>نوع المحاضرة</Label>
            <Select value={form.session_type} onValueChange={(v) => setForm({ ...form, session_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lecture">محاضرة</SelectItem>
                <SelectItem value="lab">معمل</SelectItem>
                <SelectItem value="tutorial">تطبيق</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>من</Label>
            <Input type="time" value={form.start_time.slice(0,5)} onChange={(e) => {
              const start = e.target.value;
              // preserve duration when changing start
              const dur = Math.max(60, (toMin(form.end_time) - toMin(form.start_time)) || 60);
              setForm({ ...form, start_time: start, end_time: addMin(start, dur) });
            }} />
          </div>
          <div>
            <Label>المدة</Label>
            <Select
              value={String(Math.max(1, Math.round((toMin(form.end_time) - toMin(form.start_time)) / 60)))}
              onValueChange={(v) => setForm({ ...form, end_time: addMin(form.start_time, Number(v) * 60) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">ساعة واحدة</SelectItem>
                <SelectItem value="2">ساعتان</SelectItem>
                <SelectItem value="3">ثلاث ساعات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>العدد المتوقع</Label>
            <Input type="number" value={form.expected_students} onChange={(e) => setForm({ ...form, expected_students: Number(e.target.value) })} />
          </div>

        </div>

        <div className="mt-3 border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-semibold">مصدر المحاضرة:</span>
            <Badge variant={form.source_type === "manual" ? "secondary" : form.source_type === "auto_generated" ? "default" : "outline"}>
              {form.source_type === "manual" ? "يدوي" : form.source_type === "auto_generated" ? "تلقائي" : "منسوخ"}
            </Badge>
            {form.is_locked ? (
              <Badge variant="default" className="gap-1"><Lock className="h-3 w-3" /> مقفل</Badge>
            ) : (
              <Badge variant="outline" className="gap-1"><Unlock className="h-3 w-3" /> غير مقفل</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="lock-switch"
              checked={form.is_locked}
              onCheckedChange={(v) => setForm({ ...form, is_locked: v, lock_reason: v ? form.lock_reason : null })}
            />
            <Label htmlFor="lock-switch" className="text-sm cursor-pointer">
              قفل المحاضرة (تمنع المجدول التلقائي من تحريكها أو حذفها)
            </Label>
          </div>
          {form.is_locked && (
            <div>
              <Label className="text-xs">سبب القفل</Label>
              <Textarea
                rows={2}
                value={form.lock_reason ?? ""}
                onChange={(e) => setForm({ ...form, lock_reason: e.target.value })}
                placeholder="مثال: قاعة ثابتة بطلب رئيس القسم"
              />
            </div>
          )}
        </div>


        {conflicts.length > 0 && (
          <div className="mt-3 border border-destructive/40 rounded-md p-3 bg-destructive/5 space-y-2">
            <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" /> تعارضات إلزامية ({conflicts.length})
            </div>
            {conflicts.map((c, i) => (
              <div key={i} className="text-xs">
                <Badge variant="destructive" className="ml-1">{c.code}</Badge>
                {c.message_ar}
                <div className="text-muted-foreground text-[10px]">{c.message_en}</div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {sessionId && (
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 className="h-4 w-4 ml-1" /> حذف
            </Button>
          )}
          <Button variant="outline" onClick={runValidate} disabled={validating}>
            {validating ? "جاري التحقق..." : "تحقق من التعارضات"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
