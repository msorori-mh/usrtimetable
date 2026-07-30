import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { DeliveryDemoWarningBanner } from "@/components/schedule/delivery-demo-warning-banner";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";

export const Route = createFileRoute("/_authenticated/published-schedules")({
  head: () => ({ meta: [{ title: "الجداول المنشورة" }] }),
  component: PublishedSchedulesPage,
});

function PublishedSchedulesPage() {
  const { active } = useActiveCollege();
  const [fTerm, setFTerm] = useState<string>("all");
  const [fDept, setFDept] = useState<string>("all");
  const [fProg, setFProg] = useState<string>("all");

  const { data: terms } = useQuery({
    queryKey: ["pub-terms", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase.from("academic_terms")
        .select("id, name, academic_year").eq("college_id", active!.id)
        .order("start_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: depts } = useQuery({
    queryKey: ["pub-depts", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("college_id", active!.id);
      return data ?? [];
    },
  });

  const { data: progs } = useQuery({
    queryKey: ["pub-progs", active?.id, fDept],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("academic_programs").select("id, name, department_id").eq("college_id", active!.id);
      if (fDept !== "all") q = q.eq("department_id", fDept);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["pub-versions", active?.id, fTerm],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("schedule_versions")
        .select("id, name, academic_term_id, notes, created_at, updated_at")
        .eq("college_id", active!.id).eq("status", "published")
        .order("updated_at", { ascending: false });
      if (fTerm !== "all") q = q.eq("academic_term_id", fTerm);
      const { data } = await q;
      return data ?? [];
    },
  });

  // For dept/program filter, intersect with sessions metadata
  const { data: sessionsByVersion } = useQuery({
    queryKey: ["pub-sessions-meta", active?.id, (versions ?? []).map((v) => v.id).join(",")],
    enabled: !!active && (versions?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (versions ?? []).map((v) => v.id);
      const { data } = await supabase.from("schedule_sessions")
        .select("schedule_version_id, course_offerings!inner(program_id, courses!inner(department_id))")
        .in("schedule_version_id", ids);
      const map = new Map<string, { progIds: Set<string>; deptIds: Set<string> }>();
      for (const r of data ?? []) {
        const m = map.get(r.schedule_version_id) ?? { progIds: new Set(), deptIds: new Set() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const co = r.course_offerings as any;
        if (co?.program_id) m.progIds.add(co.program_id);
        if (co?.courses?.department_id) m.deptIds.add(co.courses.department_id);
        map.set(r.schedule_version_id, m);
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    return (versions ?? []).filter((v) => {
      if (fDept === "all" && fProg === "all") return true;
      const meta = sessionsByVersion?.get(v.id);
      if (!meta) return false;
      if (fDept !== "all" && !meta.deptIds.has(fDept)) return false;
      if (fProg !== "all" && !meta.progIds.has(fProg)) return false;
      return true;
    });
  }, [versions, sessionsByVersion, fDept, fProg]);

  const termName = (id: string) => terms?.find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" /> الجداول المنشورة
          </h1>
          <p className="text-sm text-muted-foreground">عرض النسخ المنشورة فقط (للقراءة).</p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">الفصل الدراسي</label>
              <Select value={fTerm} onValueChange={setFTerm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(terms ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">القسم</label>
              <Select value={fDept} onValueChange={(v) => { setFDept(v); setFProg("all"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(depts ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">البرنامج</label>
              <Select value={fProg} onValueChange={setFProg}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(progs ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {filtered.some((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes })) && (
            <DeliveryDemoWarningBanner
              name={filtered.find((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes }))?.name}
              notes={filtered.find((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes }))?.notes}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground col-span-full">
                لا توجد نسخ منشورة بهذه المعايير.
              </Card>
            )}
            {filtered.map((v) => (
              <Card key={v.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{v.name}</span>
                  <Badge>منشور</Badge>
                </div>
                <DeliveryDemoWarningBanner name={v.name} notes={v.notes} />
                <div className="text-xs text-muted-foreground">الفصل: {termName(v.academic_term_id)}</div>
                {v.notes && <div className="text-xs">{v.notes}</div>}
                <div className="text-[10px] text-muted-foreground">{new Date(v.updated_at).toLocaleString("ar")}</div>
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link to="/timetable/$versionId" params={{ versionId: v.id }}>
                    <ExternalLink className="h-4 w-4 ml-1" /> عرض (للقراءة فقط)
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
