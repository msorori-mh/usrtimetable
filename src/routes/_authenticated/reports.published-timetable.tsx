import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/export";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import {
  fetchHydratedVersionSessions,
  type WorkspaceSessionHydratedRow,
} from "@/lib/schedule-builder/queries";
import { DeliveryDemoWarningBanner } from "@/components/schedule/delivery-demo-warning-banner";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";

export const Route = createFileRoute("/_authenticated/reports/published-timetable")({
  head: () => ({ meta: [{ title: "تقرير الجدول المنشور" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [termId, setTermId] = useState("all");
  const [versionId, setVersionId] = useState("all");
  const [deptId, setDeptId] = useState("all");
  const [progId, setProgId] = useState("all");
  const [lvlId, setLvlId] = useState("all");
  const [cohortId, setCohortId] = useState("all");
  const [dgId, setDgId] = useState("all");
  const [insId, setInsId] = useState("all");
  const [roomId, setRoomId] = useState("all");

  const { data: terms } = useQuery({
    queryKey: ["pt-terms", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id))
        .data ?? [],
  });
  const { data: versions } = useQuery({
    queryKey: ["pt-vers", active?.id, termId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("schedule_versions")
        .select("id, name, notes, academic_term_id")
        .eq("college_id", active!.id)
        .eq("status", "published");
      if (termId !== "all") q = q.eq("academic_term_id", termId);
      return (await q).data ?? [];
    },
  });
  const { data: depts } = useQuery({
    queryKey: ["pt-d", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("departments").select("id, name").eq("college_id", active!.id)).data ??
      [],
  });
  const { data: progs } = useQuery({
    queryKey: ["pt-p", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("academic_programs").select("id, name").eq("college_id", active!.id))
        .data ?? [],
  });
  const { data: levels } = useQuery({
    queryKey: ["pt-l", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("academic_levels").select("id, name").eq("college_id", active!.id))
        .data ?? [],
  });
  // A1.5: New Flow cohort/DG filter sources replace the Legacy sections selector.
  const { data: cohorts } = useQuery({
    queryKey: ["pt-c", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_cohorts")
          .select("id, code")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? [],
  });
  const { data: deliveryGroups } = useQuery({
    queryKey: ["pt-dg", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("delivery_groups")
          .select("id, group_code, cohort_id")
          .eq("college_id", active!.id)
          .order("group_code")
      ).data ?? [],
  });
  const { data: ins } = useQuery({
    queryKey: ["pt-i", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("instructors").select("id, full_name").eq("college_id", active!.id))
        .data ?? [],
  });
  const { data: rooms } = useQuery({
    queryKey: ["pt-r", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("rooms").select("id, code, name").eq("college_id", active!.id)).data ??
      [],
  });

  const filteredDeliveryGroups = useMemo(
    () =>
      (deliveryGroups ?? []).filter(
        (d) => cohortId === "all" || (d.cohort_id as string | null) === cohortId,
      ),
    [deliveryGroups, cohortId],
  );

  const versionIds = useMemo(() => {
    if (versionId !== "all") return [versionId];
    return (versions ?? []).map((v) => v.id);
  }, [versions, versionId]);

  const versionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of versions ?? []) map.set(v.id, v.name);
    return map;
  }, [versions]);

  const { data: sessionsBundle, isLoading } = useQuery({
    queryKey: [
      "pt-sess",
      active?.id,
      versionIds.join(","),
      deptId,
      progId,
      lvlId,
      cohortId,
      dgId,
      insId,
      roomId,
    ],
    enabled: !!active && versionIds.length > 0,
    queryFn: async () => {
      // Flat select + client hydrate — never nest courses under course_offerings (PGRST200).
      const hydrated: WorkspaceSessionHydratedRow[] = [];
      for (const vid of versionIds) {
        const rowsForVersion = await fetchHydratedVersionSessions({
          collegeId: active!.id,
          versionId: vid,
          studySystem: "all",
        });
        hydrated.push(...rowsForVersion);
      }
      let filtered = hydrated;
      if (progId !== "all") {
        filtered = filtered.filter((s) => s.course_offerings?.program_id === progId);
      }
      if (lvlId !== "all") {
        filtered = filtered.filter((s) => s.course_offerings?.level_id === lvlId);
      }
      if (cohortId !== "all") {
        filtered = filtered.filter((s) => s.cohort_id === cohortId);
      }
      if (dgId !== "all") {
        filtered = filtered.filter((s) => s.delivery_group_id === dgId);
      }
      if (insId !== "all") {
        filtered = filtered.filter((s) => s.instructor_id === insId);
      }
      if (roomId !== "all") {
        filtered = filtered.filter((s) => s.room_id === roomId);
      }
      if (deptId !== "all") {
        filtered = filtered.filter((s) => s.course_offerings?.courses?.department_id === deptId);
      }
      const labels = await fetchCohortDeliveryGroupLabels(active!.id, filtered);
      return { sessions: filtered, labels };
    },
  });

  const rows = useMemo(() => {
    const labels = sessionsBundle?.labels;
    return (sessionsBundle?.sessions ?? []).map((s) => ({
      version: versionNameById.get(s.schedule_version_id) ?? "",
      department: s.course_offerings?.courses?.departments?.name ?? "",
      program: s.course_offerings?.academic_programs?.name ?? "",
      level: s.course_offerings?.academic_levels?.name ?? "",
      cohort: (s.cohort_id && labels?.cohorts.get(s.cohort_id)) || "",
      delivery_group:
        (s.delivery_group_id && labels?.deliveryGroups.get(s.delivery_group_id)) || "",
      course: `${s.course_offerings?.courses?.code ?? ""} ${s.course_offerings?.courses?.name ?? ""}`,
      day: DAY_NAMES_AR[s.day_of_week] ?? "",
      time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
      session_type: s.session_type === "lab" ? "عملي" : "نظري",
      instructor: s.instructors?.full_name ?? "",
      room: s.rooms ? `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}` : "",
    }));
  }, [sessionsBundle, versionNameById]);

  const headers = [
    { key: "version", label: "النسخة" },
    { key: "department", label: "القسم" },
    { key: "program", label: "البرنامج" },
    { key: "level", label: "المستوى" },
    { key: "cohort", label: "الدفعة الدراسية" },
    { key: "delivery_group", label: "مجموعة المحاضرات/المعامل" },
    { key: "course", label: "المقرر" },
    { key: "day", label: "اليوم" },
    { key: "time", label: "الوقت" },
    { key: "session_type", label: "النوع" },
    { key: "instructor", label: "المحاضر" },
    { key: "room", label: "القاعة" },
  ];

  const selectedVersion =
    versionId !== "all" ? (versions ?? []).find((v) => v.id === versionId) : null;
  const demoBannerVersion =
    selectedVersion ??
    (versions ?? []).find((v) => isDeliveryDemoVersion({ name: v.name, notes: v.notes })) ??
    null;

  return (
    <ReportShell
      title="تقرير الجدول المنشور"
      description="النسخ ذات حالة (منشور) فقط."
      filename="published_timetable"
      rows={rows}
      headers={headers}
      isLoading={isLoading}
      leading={
        demoBannerVersion ? (
          <DeliveryDemoWarningBanner
            name={demoBannerVersion.name}
            notes={demoBannerVersion.notes}
          />
        ) : null
      }
      filters={
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Sel
            label="الفصل"
            value={termId}
            onChange={(v) => {
              setTermId(v);
              setVersionId("all");
            }}
            items={[
              { id: "all", name: "الكل" },
              ...(terms ?? []).map((t) => ({ id: t.id, name: t.name })),
            ]}
          />
          <Sel
            label="النسخة"
            value={versionId}
            onChange={setVersionId}
            items={[
              { id: "all", name: "الكل" },
              ...(versions ?? []).map((v) => ({ id: v.id, name: v.name })),
            ]}
          />
          <Sel
            label="القسم"
            value={deptId}
            onChange={setDeptId}
            items={[
              { id: "all", name: "الكل" },
              ...(depts ?? []).map((d) => ({ id: d.id, name: d.name })),
            ]}
          />
          <Sel
            label="البرنامج"
            value={progId}
            onChange={setProgId}
            items={[
              { id: "all", name: "الكل" },
              ...(progs ?? []).map((p) => ({ id: p.id, name: p.name })),
            ]}
          />
          <Sel
            label="المستوى"
            value={lvlId}
            onChange={setLvlId}
            items={[
              { id: "all", name: "الكل" },
              ...(levels ?? []).map((l) => ({ id: l.id, name: l.name })),
            ]}
          />
          <Sel
            label="الدفعة الدراسية"
            value={cohortId}
            onChange={(v) => {
              setCohortId(v);
              setDgId("all");
            }}
            items={[
              { id: "all", name: "الكل" },
              ...(cohorts ?? []).map((c) => ({ id: c.id, name: c.code ?? c.id })),
            ]}
          />
          <Sel
            label="مجموعة المحاضرات/المعامل"
            value={dgId}
            onChange={setDgId}
            items={[
              { id: "all", name: "الكل" },
              ...filteredDeliveryGroups.map((d) => ({ id: d.id, name: d.group_code })),
            ]}
          />
          <Sel
            label="المحاضر"
            value={insId}
            onChange={setInsId}
            items={[
              { id: "all", name: "الكل" },
              ...(ins ?? []).map((i) => ({ id: i.id, name: i.full_name })),
            ]}
          />
          <Sel
            label="القاعة"
            value={roomId}
            onChange={setRoomId}
            items={[
              { id: "all", name: "الكل" },
              ...(rooms ?? []).map((r) => ({ id: r.id, name: `${r.code ?? ""} ${r.name ?? ""}` })),
            ]}
          />
        </div>
      }
    >
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h.key}>{h.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {headers.map((h) => (
                  <TableCell key={h.key}>{String(r[h.key as keyof typeof r])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}

function Sel({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
