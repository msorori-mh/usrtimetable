import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chunkIds, readAllResult } from "@/lib/supabase/read-all";
import { fetchCurrentPublishedVersions } from "@/lib/schedule-versions/current-published";
import { useEducationSourcePublications } from "@/lib/schedule-versions/education-publication-loader";
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
import {
  EDUCATION_SOURCE_PUBLICATION_NOTICE_AR,
  isEducationSourcePublication,
} from "@/lib/schedule-versions/education-publication";

export const Route = createFileRoute("/_authenticated/published-schedules")({
  head: () => ({ meta: [{ title: "الجداول المنشورة" }] }),
  component: PublishedSchedulesPage,
});

function PublishedSchedulesPage() {
  const { active } = useActiveCollege();
  // Sealed education publication markers (data, M-11) re-render notices once loaded.
  useEducationSourcePublications();
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
        .order("created_at", { ascending: false });
      if (fTerm !== "all") q = q.eq("academic_term_id", fTerm);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      // M-9: the server decides which publication is current for each term; any other
      // still-published row is legacy data awaiting archive and is labelled as such.
      const current = await fetchCurrentPublishedVersions(
        active!.id,
        rows.map((v) => v.academic_term_id),
      );
      return rows
        .map((v) => ({ ...v, isCurrent: current.get(v.academic_term_id) === v.id }))
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
    },
  });

  // For dept/program filter, intersect with sessions metadata
  const { data: sessionsByVersion } = useQuery({
    queryKey: ["pub-sessions-meta", active?.id, (versions ?? []).map((v) => v.id).join(",")],
    enabled: !!active && (versions?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (versions ?? []).map((v) => v.id);
      const { data: sessionRows, error: sessionError } = await readAllResult<{
        schedule_version_id: string;
        course_offering_id: string | null;
      }>((from, to) =>
        supabase
          .from("schedule_sessions")
          .select("schedule_version_id, course_offering_id")
          .in("schedule_version_id", ids)
          .order("id")
          .range(from, to),
      );
      if (sessionError) throw sessionError;

      const offeringIds = Array.from(
        new Set((sessionRows ?? []).map((row) => row.course_offering_id).filter(Boolean)),
      );
      // H-10: id lists are chunked (URL length) and each chunk is read in full.
      const readByIds = async <T,>(table: "course_offerings" | "courses", columns: string, ids: string[]) => {
        const out: T[] = [];
        for (const chunk of chunkIds(ids)) {
          const res = await readAllResult<T>((from, to) =>
            supabase
              .from(table)
              .select(columns)
              .eq("college_id", active!.id)
              .in("id", chunk)
              .order("id")
              .range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
          );
          if (res.error) throw res.error;
          out.push(...(res.data ?? []));
        }
        return out;
      };
      const offeringRows = await readByIds<{ id: string; program_id: string | null; course_id: string | null }>(
        "course_offerings",
        "id, program_id, course_id",
        offeringIds as string[],
      );

      const courseIds = Array.from(
        new Set((offeringRows ?? []).map((row) => row.course_id).filter(Boolean)),
      );
      const courseRows = await readByIds<{ id: string; department_id: string | null }>(
        "courses",
        "id, department_id",
        courseIds as string[],
      );

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
                  {v.isCurrent ? (
                    <Badge>منشور — الحالي</Badge>
                  ) : (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
                      نسخة منشورة سابقة تحتاج أرشفة
                    </span>
                  )}
                </div>
                <DeliveryDemoWarningBanner name={v.name} notes={v.notes} />
                {isEducationSourcePublication(v.id, v.academic_term_id) && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                    {EDUCATION_SOURCE_PUBLICATION_NOTICE_AR}{" "}
                    <Link className="underline" to="/reports/education-source-timetable">
                      تقرير المطابقة
                    </Link>
                  </p>
                )}
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
