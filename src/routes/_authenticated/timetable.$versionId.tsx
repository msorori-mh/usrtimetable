import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowRight, Plus, Gauge, Activity, AlertTriangle, GripVertical } from "lucide-react";
import { TimetableGrid, type GridSession, type AvailabilityWindow, type DropPayload } from "@/components/timetable/timetable-grid";
import { SessionDialog } from "@/components/timetable/session-dialog";
import { scoreScheduleVersion, type QualityResult } from "@/lib/conflict-engine/scorer";
import { validateProposed } from "@/lib/conflict-engine/validator";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/timetable/$versionId")({
  head: () => ({ meta: [{ title: "محرر الجدول الزمني" }] }),
  component: TimetablePage,
});

const toMin = (s: string) => { const [h, m] = s.slice(0,5).split(":").map(Number); return h * 60 + m; };
const addMin = (s: string, add: number) => {
  const total = toMin(s) + add;
  const h = Math.floor(total / 60) % 24, m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

function TimetablePage() {
  const { versionId } = Route.useParams();
  const { active } = useActiveCollege();
  const canManageRole = useCanManageActiveCollege();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<any>(undefined);
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [scoring, setScoring] = useState(false);

  const [fDept, setFDept] = useState<string>("all");
  const [fProg, setFProg] = useState<string>("all");
  const [fLevel, setFLevel] = useState<string>("all");
  const [fInstr, setFInstr] = useState<string>("all");
  const [fRoom, setFRoom] = useState<string>("all");
  const [fStudy, setFStudy] = useState<string>("all");
  const [gridStudy, setGridStudy] = useState<"regular" | "parallel" | "both">("regular");

  const { data: version } = useQuery({
    queryKey: ["sv-detail", versionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_versions")
        .select("id, name, status, college_id, academic_term_id").eq("id", versionId).single();
      if (error) throw error; return data;
    },
  });

  const isLocked = version?.status === "published" || version?.status === "archived";
  const canManage = canManageRole && !isLocked;


  const { data: sessions } = useQuery({
    queryKey: ["sessions-for-version", versionId],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_sessions")
        .select("*, course_offerings(course_id, program_id, level_id, courses(code, name, department_id)), instructors(full_name), rooms(code, name)")
        .eq("schedule_version_id", versionId);
      if (error) throw error; return data ?? [];
    },
  });

  const { data: lookups } = useQuery({
    queryKey: ["timetable-lookups", active?.id, version?.academic_term_id],
    enabled: !!active,
    queryFn: async () => {
      const [depts, progs, levels, instrs, rooms, offerings, tas, templates, settings, roomTypes] = await Promise.all([
        supabase.from("departments").select("id, name").eq("college_id", active!.id),
        supabase.from("academic_programs").select("id, name, department_id").eq("college_id", active!.id),
        supabase.from("academic_levels").select("id, name, program_id").eq("college_id", active!.id),
        supabase.from("instructors").select("id, full_name").eq("college_id", active!.id),
        supabase.from("rooms").select("id, code, name, room_type_id").eq("college_id", active!.id),
        supabase.from("course_offerings")
          .select("id, course_id, program_id, level_id, expected_students, plan_course_id, courses(code, name, department_id)")
          .eq("college_id", active!.id).eq("term_id", version?.academic_term_id ?? ""),
        supabase.from("teaching_assignments")
          .select("id, course_offering_id, instructor_id, instructors(full_name)")
          .eq("college_id", active!.id),
        supabase.from("time_slot_templates").select("*").eq("college_id", active!.id).eq("is_active", true),
        supabase.from("scheduling_settings").select("*").eq("college_id", active!.id).maybeSingle(),
        supabase.from("room_types").select("id, name_ar").eq("college_id", active!.id),
      ]);
      return {
        depts: depts.data ?? [], progs: progs.data ?? [], levels: levels.data ?? [],
        instrs: instrs.data ?? [], rooms: rooms.data ?? [],
        offerings: offerings.data ?? [], tas: tas.data ?? [],
        templates: templates.data ?? [], settings: settings.data ?? null,
        roomTypes: roomTypes.data ?? [],
      };
    },
  });

  // Working days & hours from settings or default
  const workingDays = lookups?.settings?.working_days ?? [6, 0, 1, 2, 3, 4];
  const startHour = lookups?.settings?.day_start_time
    ? parseInt(String(lookups.settings.day_start_time).slice(0, 2), 10) : 8;
  const endHour = lookups?.settings?.day_end_time
    ? parseInt(String(lookups.settings.day_end_time).slice(0, 2), 10) : 20;

  // Availability windows from templates (filtered by selected gridStudy), else from settings day range
  const availability: AvailabilityWindow[] | undefined = useMemo(() => {
    const tpl = (lookups?.templates ?? []).filter(
      (t: any) => t.study_system === gridStudy || t.study_system === "both" || gridStudy === "both",
    );
    if (tpl.length > 0) {
      return tpl.map((t: any) => ({
        day_of_week: t.day_of_week,
        start_time: t.start_time,
        end_time: t.end_time,
      }));
    }
    if (lookups?.settings) {
      return workingDays.map((d: number) => ({
        day_of_week: d,
        start_time: String(lookups.settings!.day_start_time),
        end_time: String(lookups.settings!.day_end_time),
      }));
    }
    return undefined;
  }, [lookups, gridStudy, workingDays]);

  const filtered = useMemo(() => {
    return (sessions ?? []).filter((s: any) => {
      if (fDept !== "all" && s.course_offerings?.courses?.department_id !== fDept) return false;
      if (fProg !== "all" && s.course_offerings?.program_id !== fProg) return false;
      if (fLevel !== "all" && s.course_offerings?.level_id !== fLevel) return false;
      if (fInstr !== "all" && s.instructor_id !== fInstr) return false;
      if (fRoom !== "all" && s.room_id !== fRoom) return false;
      if (fStudy !== "all" && s.study_system !== fStudy) return false;
      return true;
    });
  }, [sessions, fDept, fProg, fLevel, fInstr, fRoom, fStudy]);

  const gridSessions: GridSession[] = useMemo(() => (filtered ?? []).map((s: any) => ({
    id: s.id,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    study_system: s.study_system,
    session_type: s.session_type,
    title: `${s.is_locked ? "🔒 " : ""}${s.course_offerings?.courses?.code ?? ""} — ${s.course_offerings?.courses?.name ?? ""}`,
    subtitle: `${s.instructors?.full_name ?? ""}${s.rooms ? ` • ${s.rooms.code}` : ""}${s.source_type === "auto_generated" ? " • تلقائي" : s.source_type === "cloned" ? " • منسوخ" : ""}`,
    badge: s.study_system === "parallel" ? "موازي" : s.study_system === "both" ? "م/م" : "انتظام",
  })), [filtered]);

  const unscheduled = useMemo(() => {
    const scheduledOfferingIds = new Set((sessions ?? []).map((s: any) => s.course_offering_id));
    return (lookups?.offerings ?? []).filter((o: any) => !scheduledOfferingIds.has(o.id));
  }, [sessions, lookups]);

  // Group unscheduled by department > program > level
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, any[]>>>();
    const deptName = (id: string | null) => lookups?.depts.find((d: any) => d.id === id)?.name ?? "—";
    const progName = (id: string | null) => lookups?.progs.find((p: any) => p.id === id)?.name ?? "—";
    const lvlName = (id: string | null) => lookups?.levels.find((l: any) => l.id === id)?.name ?? "—";
    for (const o of unscheduled as any[]) {
      const dk = deptName(o.courses?.department_id ?? null);
      const pk = progName(o.program_id ?? null);
      const lk = lvlName(o.level_id ?? null);
      if (!map.has(dk)) map.set(dk, new Map());
      const pm = map.get(dk)!;
      if (!pm.has(pk)) pm.set(pk, new Map());
      const lm = pm.get(pk)!;
      if (!lm.has(lk)) lm.set(lk, []);
      lm.get(lk)!.push(o);
    }
    return map;
  }, [unscheduled, lookups]);

  const runQuality = async () => {
    if (!active) return;
    setScoring(true);
    try {
      const { result } = await scoreScheduleVersion({ collegeId: active.id, scheduleVersionId: versionId });
      setQuality(result);
      toast.success(`الجودة: ${result.total_score}/100`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setScoring(false); }
  };

  // Drop handler: from unscheduled OR from existing session (move)
  const handleDrop = async (params: { day: number; startTime: string; payload: DropPayload }) => {
    if (!active || !canManage) return;
    const { day, startTime, payload } = params;
    if (payload.kind === "unscheduled") {
      const offering = unscheduled.find((o: any) => o.id === payload.id);
      if (!offering) return;
      const ta = lookups?.tas.find((t: any) => t.course_offering_id === offering.id);
      setEditId(null);
      setPrefill({
        course_offering_id: offering.id,
        teaching_assignment_id: ta?.id ?? null,
        instructor_id: ta?.instructor_id ?? "",
        study_system: gridStudy,
        day_of_week: day,
        start_time: startTime,
        end_time: addMin(startTime, 120),
        expected_students: offering.expected_students ?? 0,
      });
      setDialogOpen(true);
      return;
    }
    // Move existing session
    const existing = (sessions ?? []).find((s: any) => s.id === payload.id);
    if (!existing) return;
    if (existing.is_locked) {
      toast.error("المحاضرة مقفلة — يجب فك القفل قبل التحريك");
      return;
    }
    const duration = toMin(existing.end_time) - toMin(existing.start_time);
    const newEnd = addMin(startTime, duration);
    // Validate (excluding self)
    const validation = await validateProposed({
      collegeId: active.id,
      scheduleVersionId: versionId,
      sessions: [{
        id: existing.id,
        course_offering_id: existing.course_offering_id,
        teaching_assignment_id: existing.teaching_assignment_id,
        instructor_id: existing.instructor_id,
        room_id: existing.room_id,
        section_id: existing.section_id,
        section_group_id: existing.section_group_id,
        study_system: existing.study_system as any,
        day_of_week: day,
        start_time: startTime,
        end_time: newEnd,
        session_type: existing.session_type,
        expected_students: existing.expected_students,
      }],
      excludeExistingSessionIds: [existing.id],
    });
    if (validation.unapprovedHardConflicts > 0) {
      toast.error(`⚠️ نقل مرفوض — ${validation.unapprovedHardConflicts} تعارض (${validation.conflicts[0].message_ar})`);
      await logAudit({ action: "blocked_conflict", entity: "schedule_sessions", entityId: existing.id, collegeId: active.id, details: { codes: validation.conflicts.map(c => c.code) } });
      return;
    }
    const { error } = await supabase.from("schedule_sessions").update({
      day_of_week: day, start_time: startTime, end_time: newEnd,
    }).eq("id", existing.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "drag_move", entity: "schedule_sessions", entityId: existing.id, collegeId: active.id, details: { day, start_time: startTime } });
    toast.success("تم نقل المحاضرة");
    qc.invalidateQueries({ queryKey: ["sessions-for-version", versionId] });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/schedule-versions"><ArrowRight className="h-4 w-4 ml-1" /> عودة للنسخ</Link>
          </Button>
          <h1 className="text-2xl font-bold mt-1">
            {version?.name ?? "..."} <Badge variant="secondary">{version?.status}</Badge>
          </h1>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <Label className="text-xs">عرض شبكة</Label>
            <Select value={gridStudy} onValueChange={(v) => setGridStudy(v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">كلاهما</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={runQuality} disabled={scoring}>
            <Gauge className="h-4 w-4 ml-1" /> {scoring ? "..." : "احتساب الجودة"}
          </Button>
          <Button disabled={!canManage} onClick={() => { setEditId(null); setPrefill(undefined); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 ml-1" /> محاضرة جديدة
          </Button>
      </div>

      {isLocked && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm">
          🔒 هذه النسخة <strong>{version?.status === "published" ? "منشورة" : "مؤرشفة"}</strong> — العرض للقراءة فقط. لا يمكن إضافة أو تعديل أو حذف المحاضرات.
        </div>
      )}

      </div>

      {quality && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> الجودة</div><div className="text-3xl font-bold">{quality.total_score}/100</div></Card>
          <Card className="p-3"><div className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> تعارضات إلزامية</div><div className="text-3xl font-bold">{quality.hard_conflicts_count}</div></Card>
          <Card className="p-3"><div className="text-xs text-amber-600 flex items-center gap-1"><Activity className="h-3 w-3" /> مخالفات مرنة</div><div className="text-3xl font-bold">{quality.soft_conflicts_count}</div></Card>
        </div>
      )}

      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div><Label className="text-xs">القسم</Label>
            <Select value={fDept} onValueChange={setFDept}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>{lookups?.depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">البرنامج</Label>
            <Select value={fProg} onValueChange={setFProg}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>{lookups?.progs.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">المستوى</Label>
            <Select value={fLevel} onValueChange={setFLevel}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>{lookups?.levels.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">المحاضر</Label>
            <Select value={fInstr} onValueChange={setFInstr}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>{lookups?.instrs.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">القاعة</Label>
            <Select value={fRoom} onValueChange={setFRoom}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>{lookups?.rooms.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.code} — {d.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">نظام (تصفية)</Label>
            <Select value={fStudy} onValueChange={setFStudy}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">كلاهما</SelectItem>
              </SelectContent></Select></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <TimetableGrid
            sessions={gridSessions}
            workingDays={workingDays}
            startHour={startHour}
            endHour={endHour}
            availability={availability}
            draggable={canManage}
            onSessionClick={(id) => { setEditId(id); setPrefill(undefined); setDialogOpen(true); }}
            onDropAt={handleDrop}
          />
        </div>
        <Card className="p-3 max-h-[700px] overflow-auto">
          <div className="font-semibold mb-2 text-sm">عناصر غير مجدولة ({unscheduled.length})</div>
          <Accordion type="multiple" className="w-full">
            {Array.from(grouped.entries()).map(([dept, progMap]) => (
              <AccordionItem key={dept} value={dept}>
                <AccordionTrigger className="text-xs">{dept}</AccordionTrigger>
                <AccordionContent>
                  {Array.from(progMap.entries()).map(([prog, lvlMap]) => (
                    <div key={prog} className="mb-2">
                      <div className="text-[11px] font-medium text-muted-foreground mb-1">{prog}</div>
                      {Array.from(lvlMap.entries()).map(([lvl, items]) => (
                        <div key={lvl} className="pr-2">
                          <div className="text-[10px] text-muted-foreground">{lvl}</div>
                          <div className="space-y-1">
                            {items.map((o: any) => {
                              const ta = lookups?.tas.find((t: any) => t.course_offering_id === o.id);
                              const insName = ta ? (ta as any).instructors?.full_name : "—";
                              return (
                                <div key={o.id}
                                  draggable={canManage}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("application/x-lovable-drop", JSON.stringify({ kind: "unscheduled", id: o.id }));
                                    e.dataTransfer.effectAllowed = "copy";
                                  }}
                                  className="border rounded p-2 text-xs bg-card hover:bg-accent/30 cursor-grab active:cursor-grabbing"
                                >
                                  <div className="flex items-start gap-1">
                                    <GripVertical className="h-3 w-3 mt-0.5 text-muted-foreground" />
                                    <div className="flex-1">
                                      <div className="font-medium">{o.courses?.code} — {o.courses?.name}</div>
                                      <div className="text-[10px] text-muted-foreground">المحاضر: {insName}</div>
                                      <div className="text-[10px] text-muted-foreground">الطلاب المتوقعون: {o.expected_students ?? 0}</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {unscheduled.length === 0 && <div className="text-xs text-muted-foreground">لا توجد عناصر.</div>}
        </Card>
      </div>

      {active && (
        <SessionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          collegeId={active.id}
          scheduleVersionId={versionId}
          sessionId={editId}
          defaults={prefill}
        />
      )}
    </div>
  );
}
