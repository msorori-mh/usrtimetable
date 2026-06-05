import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ArrowRight, Plus, Gauge, Activity, AlertTriangle } from "lucide-react";
import { TimetableGrid, type GridSession } from "@/components/timetable/timetable-grid";
import { SessionDialog } from "@/components/timetable/session-dialog";
import { scoreScheduleVersion, type QualityResult } from "@/lib/conflict-engine/scorer";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/timetable/$versionId")({
  head: () => ({ meta: [{ title: "محرر الجدول الزمني" }] }),
  component: TimetablePage,
});

function TimetablePage() {
  const { versionId } = Route.useParams();
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [scoring, setScoring] = useState(false);

  // Filters
  const [fDept, setFDept] = useState<string>("all");
  const [fProg, setFProg] = useState<string>("all");
  const [fLevel, setFLevel] = useState<string>("all");
  const [fInstr, setFInstr] = useState<string>("all");
  const [fRoom, setFRoom] = useState<string>("all");
  const [fStudy, setFStudy] = useState<string>("all");

  const { data: version } = useQuery({
    queryKey: ["sv-detail", versionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("schedule_versions")
        .select("id, name, status, college_id, academic_term_id").eq("id", versionId).single();
      if (error) throw error; return data;
    },
  });

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
    queryKey: ["timetable-lookups", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const [depts, progs, levels, instrs, rooms, offerings, tas] = await Promise.all([
        supabase.from("departments").select("id, name").eq("college_id", active!.id),
        supabase.from("academic_programs").select("id, name").eq("college_id", active!.id),
        supabase.from("academic_levels").select("id, name, program_id").eq("college_id", active!.id),
        supabase.from("instructors").select("id, full_name").eq("college_id", active!.id),
        supabase.from("rooms").select("id, code, name").eq("college_id", active!.id),
        supabase.from("course_offerings")
          .select("id, course_id, program_id, level_id, courses(code, name)")
          .eq("college_id", active!.id).eq("term_id", version?.academic_term_id ?? ""),
        supabase.from("teaching_assignments")
          .select("id, course_offering_id, instructor_id, instructors(full_name)")
          .eq("college_id", active!.id),
      ]);
      return {
        depts: depts.data ?? [], progs: progs.data ?? [], levels: levels.data ?? [],
        instrs: instrs.data ?? [], rooms: rooms.data ?? [],
        offerings: offerings.data ?? [], tas: tas.data ?? [],
      };
    },
  });

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
    title: `${s.course_offerings?.courses?.code ?? ""} — ${s.course_offerings?.courses?.name ?? ""}`,
    subtitle: `${s.instructors?.full_name ?? ""}${s.rooms ? ` • ${s.rooms.code}` : ""}`,
    badge: s.study_system === "parallel" ? "موازي" : s.study_system === "both" ? "م/م" : "انتظام",
  })), [filtered]);

  const unscheduled = useMemo(() => {
    const scheduledOfferingIds = new Set((sessions ?? []).map((s: any) => s.course_offering_id));
    return (lookups?.offerings ?? []).filter((o: any) => !scheduledOfferingIds.has(o.id));
  }, [sessions, lookups]);

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
        <div className="flex gap-2">
          <Button variant="outline" onClick={runQuality} disabled={scoring}>
            <Gauge className="h-4 w-4 ml-1" /> {scoring ? "..." : "احتساب الجودة"}
          </Button>
          <Button disabled={!canManage} onClick={() => { setEditId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 ml-1" /> جلسة جديدة
          </Button>
        </div>
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
          <div><Label className="text-xs">نظام الدراسة</Label>
            <Select value={fStudy} onValueChange={setFStudy}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">الإثنين</SelectItem>
              </SelectContent></Select></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <TimetableGrid sessions={gridSessions} onSessionClick={(id) => { setEditId(id); setDialogOpen(true); }} />
        </div>
        <Card className="p-3 max-h-[700px] overflow-auto">
          <div className="font-semibold mb-2 text-sm">عناصر غير مجدولة ({unscheduled.length})</div>
          <div className="space-y-1">
            {unscheduled.map((o: any) => (
              <div key={o.id} className="border rounded p-2 text-xs">
                <div className="font-medium">{o.courses?.code} — {o.courses?.name}</div>
                <Button size="sm" variant="outline" className="mt-1 w-full" disabled={!canManage}
                  onClick={() => { setEditId(null); setDialogOpen(true); }}>
                  جدولة
                </Button>
              </div>
            ))}
            {unscheduled.length === 0 && <div className="text-xs text-muted-foreground">لا توجد عناصر.</div>}
          </div>
        </Card>
      </div>

      {active && (
        <SessionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          collegeId={active.id}
          scheduleVersionId={versionId}
          sessionId={editId}
        />
      )}
    </div>
  );
}
