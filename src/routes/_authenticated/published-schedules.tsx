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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, ExternalLink, Printer } from "lucide-react";
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
      const { data } = await supabase
        .from("academic_terms")
        .select("id, name, academic_year")
        .eq("college_id", active!.id)
        .order("start_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: depts } = useQuery({
    queryKey: ["pub-depts", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase
        .from("departments")
        .select("id, name")
        .eq("college_id", active!.id);
      return data ?? [];
    },
  });

  const { data: progs } = useQuery({
    queryKey: ["pub-progs", active?.id, fDept],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("academic_programs")
        .select("id, name, department_id")
        .eq("college_id", active!.id);
      if (fDept !== "all") q = q.eq("department_id", fDept);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["pub-versions", active?.id, fTerm],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("schedule_versions")
        .select("id, name, academic_term_id, notes, created_at, updated_at")
        .eq("college_id", active!.id)
        .eq("status", "published")
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
      const { data: sessionRows, error: sessionError } = await supabase
        .from("schedule_sessions")
        .select("schedule_version_id, course_offering_id")
        .in("schedule_version_id", ids);
      if (sessionError) throw sessionError;

      const offeringIds = Array.from(
        new Set((sessionRows ?? []).map((row) => row.course_offering_id).filter(Boolean)),
      );
      const { data: offeringRows, error: offeringError } = offeringIds.length
        ? await supabase
            .from("course_offerings")
            .select("id, program_id, course_id")
            .eq("college_id", active!.id)
            .in("id", offeringIds)
        : { data: [], error: null };
      if (offeringError) throw offeringError;

      const courseIds = Array.from(
        new Set((offeringRows ?? []).map((row) => row.course_id).filter(Boolean)),
      );
      const { data: courseRows, error: courseError } = courseIds.length
        ? await supabase
            .from("courses")
            .select("id, department_id")
            .eq("college_id", active!.id)
            .in("id", courseIds)
        : { data: [], error: null };
      if (courseError) throw courseError;

      const offeringsById = new Map((offeringRows ?? []).map((row) => [row.id, row]));
      const departmentsByCourseId = new Map(
        (courseRows ?? []).map((row) => [row.id, row.department_id]),
      );
      const map = new Map<string, { progIds: Set<string>; deptIds: Set<string> }>();
      for (const row of sessionRows ?? []) {
        const meta = map.get(row.schedule_version_id) ?? {
          progIds: new Set<string>(),
          deptIds: new Set<string>(),
        };
        const offering = row.course_offering_id
          ? offeringsById.get(row.course_offering_id)
          : undefined;
        if (offering?.program_id) meta.progIds.add(offering.program_id);
        const departmentId = offering?.course_id
          ? departmentsByCourseId.get(offering.course_id)
          : undefined;
        if (departmentId) meta.deptIds.add(departmentId);
        map.set(row.schedule_version_id, meta);
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(terms ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">القسم</label>
              <Select
                value={fDept}
                onValueChange={(v) => {
                  setFDept(v);
                  setFProg("all");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(depts ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">البرنامج</label>
              <Select value={fProg} onValueChange={setFProg}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(progs ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {filtered.some((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes })) && (
            <DeliveryDemoWarningBanner
              name={
                filtered.find((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes }))?.name
              }
              notes={
                filtered.find((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes }))?.notes
              }
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
                <div className="text-xs text-muted-foreground">
                  الفصل: {termName(v.academic_term_id)}
                </div>
                {v.notes && <div className="text-xs">{v.notes}</div>}
                <div className="text-[10px] text-muted-foreground">
                  {new Date(v.updated_at).toLocaleString("ar")}
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row">
                  <Button variant="outline" size="sm" asChild className="w-full sm:flex-1">
                    <Link to="/timetable/$versionId" params={{ versionId: v.id }}>
                      <ExternalLink className="h-4 w-4 ml-1" /> عرض (للقراءة فقط)
                    </Link>
                  </Button>
                  {/*
                    LAUNCH-CLOSURE-01: the published list is the distribution surface,
                    so the printable timetable must be reachable directly from it
                    instead of only via the schedule editor.
                  */}
                  <Button
                    size="sm"
                    asChild
                    className="w-full sm:flex-1"
                    data-testid="published-print-link"
                  >
                    <Link to="/timetable/$versionId/print" params={{ versionId: v.id }}>
                      <Printer className="h-4 w-4 ml-1" /> طباعة وتصدير
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
