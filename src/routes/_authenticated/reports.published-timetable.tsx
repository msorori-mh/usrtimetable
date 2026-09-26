import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
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
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { StudentScheduleTables } from "@/components/reports/student-schedule-tables";
import { DAY_NAMES_AR, compactAcademicLevelLabel, fmtTime } from "@/lib/reports/export";
import { filterRowsBySearch } from "@/lib/reports/search";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import {
  fetchHydratedVersionSessions,
  type WorkspaceSessionHydratedRow,
} from "@/lib/schedule-builder/queries";
import { DeliveryDemoWarningBanner } from "@/components/schedule/delivery-demo-warning-banner";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import {
  EDUCATION_SOURCE_PUBLICATION_NOTICE_AR,
  isEducationSourcePublication,
} from "@/lib/schedule-versions/education-publication";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/reports/published-timetable")({
  head: () => ({ meta: [{ title: "تقرير الجدول المنشور" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [termId, setTermId] = useState("all");
  const [versionId, setVersionId] = useState("");
  const [deptId, setDeptId] = useState("all");
  const [progId, setProgId] = useState("all");
  const [lvlId, setLvlId] = useState("all");
  const [cohortId, setCohortId] = useState("all");
  const [dgId, setDgId] = useState("all");
  const [insId, setInsId] = useState("all");
  const [roomId, setRoomId] = useState("all");
  const [search, setSearch] = useState("");

  const { data: terms, error: termsError } = useQuery({
    queryKey: ["pt-terms", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });
  const { data: versions, error: versionsError } = useQuery({
    queryKey: ["pt-vers", active?.id, termId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("schedule_versions")
        .select("id, name, notes, academic_term_id")
        .eq("college_id", active!.id)
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (termId !== "all") q = q.eq("academic_term_id", termId);
      return (await q.throwOnError()).data ?? [];
    },
  });
  const { data: depts, error: deptsError } = useQuery({
    queryKey: ["pt-d", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });
  const { data: progs, error: progsError } = useQuery({
    queryKey: ["pt-p", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_programs")
          .select("id, name, department_id")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });
  const { data: levels, error: levelsError } = useQuery({
    queryKey: ["pt-l", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name, program_id")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });
  // A1.5: New Flow cohort/DG filter sources replace the Legacy sections selector.
  const { data: cohorts, error: cohortsError } = useQuery({
    queryKey: ["pt-c", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_cohorts")
          .select("id, code, program_id, level_id, term_id")
          .eq("college_id", active!.id)
          .order("code")
          .throwOnError()
      ).data ?? [],
  });
  const { data: deliveryGroups, error: deliveryGroupsError } = useQuery({
    queryKey: ["pt-dg", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("delivery_groups")
          .select("id, group_code, cohort_id")
          .eq("college_id", active!.id)
          .order("group_code")
          .throwOnError()
      ).data ?? [],
  });
  const { data: ins, error: insError } = useQuery({
    queryKey: ["pt-i", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });
  const { data: rooms, error: roomsError } = useQuery({
    queryKey: ["pt-r", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, code, name")
          .eq("college_id", active!.id)
          .throwOnError()
      ).data ?? [],
  });

  const filteredDeliveryGroups = useMemo(
    () =>
      (deliveryGroups ?? []).filter(
        (d) => cohortId === "all" || (d.cohort_id as string | null) === cohortId,
      ),
    [deliveryGroups, cohortId],
  );

  useEffect(() => {
    if (!versions) return;
    if (!versions.some((v) => v.id === versionId)) setVersionId(versions[0]?.id ?? "");
  }, [versions, versionId]);
  const versionIds = useMemo(
    () => (versions?.some((v) => v.id === versionId) ? [versionId] : []),
    [versions, versionId],
  );
  const scopedPrograms = (progs ?? []).filter(
    (p) => deptId === "all" || p.department_id === deptId,
  );
  const scopedLevels = (levels ?? []).filter((l) => progId === "all" || l.program_id === progId);
  const scopedCohorts = (cohorts ?? []).filter(
    (c) =>
      (termId === "all" || c.term_id === termId) &&
      (progId === "all" || c.program_id === progId) &&
      (lvlId === "all" || c.level_id === lvlId),
  );

  const versionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of versions ?? []) map.set(v.id, v.name);
    return map;
  }, [versions]);

  const {
    data: sessionsBundle,
    isLoading,
    error: sessionsError,
    refetch,
  } = useQuery({
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

  const allRows = useMemo(() => {
    const labels = sessionsBundle?.labels;
    return (sessionsBundle?.sessions ?? []).map((s) => ({
      id: s.id,
      scope_key: JSON.stringify([
        s.schedule_version_id,
        s.course_offerings?.program_id,
        s.course_offerings?.level_id,
        s.cohort_id,
        s.study_system,
      ]),
      day_order: s.day_of_week,
      study_system:
        s.study_system === "parallel"
          ? "موازي"
          : s.study_system === "both"
            ? "مشترك (عام وموازي)"
            : "عام",
      version: versionNameById.get(s.schedule_version_id ?? "") ?? "",
      department:
        depts?.find(
          (d) =>
            d.id === progs?.find((p) => p.id === s.course_offerings?.program_id)?.department_id,
        )?.name ??
        s.course_offerings?.courses?.departments?.name ??
        "",
      program: s.course_offerings?.academic_programs?.name ?? "",
      level: compactAcademicLevelLabel(s.course_offerings?.academic_levels?.name),
      cohort: (s.cohort_id && labels?.cohorts.get(s.cohort_id)) || "",
      delivery_group:
        (s.delivery_group_id && labels?.deliveryGroups.get(s.delivery_group_id)) || "",
      course: entityDisplayName(s.course_offerings?.courses ?? {}, ""),
      day: DAY_NAMES_AR[s.day_of_week] ?? "",
      time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
      session_type: s.session_type === "lab" ? "عملي" : "نظري",
      instructor: s.instructors?.full_name ?? "",
      room: s.rooms ? entityDisplayName(s.rooms, "") : "",
    }));
  }, [sessionsBundle, versionNameById, depts, progs]);

  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

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

  const nameOf = (items: { id: string; name: string }[], id: string) =>
    id === "all" ? "الكل" : (items.find((i) => i.id === id)?.name ?? "—");

  return (
    <ReportShell
      title="تقرير الجدول المنشور"
      description="محاضرات نسخة منشورة واحدة، مع خيارات البحث والطباعة والتصدير."
      official
      filename="published_timetable"
      shareParams={{ versionId }}
      rows={rows}
      headers={headers}
      isLoading={isLoading}
      error={
        sessionsError ??
        termsError ??
        versionsError ??
        deptsError ??
        progsError ??
        levelsError ??
        cohortsError ??
        deliveryGroupsError ??
        insError ??
        roomsError
      }
      onRetry={() => void refetch()}
      headerMeta={{
        termName: terms?.find((t) => t.id === selectedVersion?.academic_term_id)?.name,
        versionName: selectedVersion?.name,
        versionStatus: "published",
      }}
      notReadyMessage={
        !active
          ? "اختر كلّية لعرض الجدول المنشور."
          : !versionIds.length
            ? "لا توجد نسخة منشورة في النطاق المختار."
            : undefined
      }
      emptyMessage={
        search ? "لا نتائج مطابقة للبحث." : "لا توجد محاضرات في نسخة منشورة بهذه المعايير."
      }
      kpis={[
        { label: "المحاضرات", value: rows.length },
        { label: "المقررات", value: new Set(rows.map((r) => r.course)).size },
        { label: "المحاضرون", value: new Set(rows.map((r) => r.instructor)).size },
        { label: "القاعات", value: new Set(rows.map((r) => r.room).filter(Boolean)).size },
        { label: "الدفعات", value: new Set(rows.map((r) => r.cohort).filter(Boolean)).size },
      ]}
      leading={
        demoBannerVersion ||
        isEducationSourcePublication(versionId, selectedVersion?.academic_term_id) ? (
          <>
            {demoBannerVersion && (
              <DeliveryDemoWarningBanner
                name={demoBannerVersion.name}
                notes={demoBannerVersion.notes}
              />
            )}
            {isEducationSourcePublication(versionId, selectedVersion?.academic_term_id) && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                {EDUCATION_SOURCE_PUBLICATION_NOTICE_AR}{" "}
                <Link className="underline" to="/reports/education-source-timetable">
                  تقرير المطابقة
                </Link>
              </p>
            )}
          </>
        ) : null
      }
      filters={
        <ReportFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث بالمقرر أو المحاضر أو القاعة…",
          }}
          activeSummary={[
            `الفصل: ${nameOf(
              (terms ?? []).map((t) => ({ id: t.id, name: t.name })),
              termId,
            )}`,
            `النسخة: ${nameOf(
              (versions ?? []).map((v) => ({ id: v.id, name: v.name })),
              versionId,
            )}`,
            `القسم: ${nameOf(
              (depts ?? []).map((d) => ({ id: d.id, name: d.name })),
              deptId,
            )}`,
            `البرنامج: ${nameOf(
              (progs ?? []).map((p) => ({ id: p.id, name: p.name })),
              progId,
            )}`,
            `المستوى: ${nameOf(
              (levels ?? []).map((l) => ({ id: l.id, name: compactAcademicLevelLabel(l.name) })),
              lvlId,
            )}`,
            `الدفعة: ${nameOf(
              (cohorts ?? []).map((c) => ({ id: c.id, name: c.code ?? c.id })),
              cohortId,
            )}`,
          ]}
          onClear={() => {
            setTermId("all");
            setVersionId("");
            setDeptId("all");
            setProgId("all");
            setLvlId("all");
            setCohortId("all");
            setDgId("all");
            setInsId("all");
            setRoomId("all");
            setSearch("");
          }}
          basic={
            <>
              <Sel
                label="الفصل"
                value={termId}
                onChange={(v) => {
                  setTermId(v);
                  setVersionId("");
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
                items={[...(versions ?? []).map((v) => ({ id: v.id, name: v.name }))]}
              />
              <Sel
                label="البرنامج"
                value={progId}
                onChange={(v) => {
                  setProgId(v);
                  setLvlId("all");
                  setCohortId("all");
                  setDgId("all");
                }}
                items={[
                  { id: "all", name: "الكل" },
                  ...scopedPrograms.map((p) => ({ id: p.id, name: p.name })),
                ]}
              />
              <Sel
                label="المستوى"
                value={lvlId}
                onChange={(v) => {
                  setLvlId(v);
                  setCohortId("all");
                  setDgId("all");
                }}
                items={[
                  { id: "all", name: "الكل" },
                  ...scopedLevels.map((l) => ({
                    id: l.id,
                    name: compactAcademicLevelLabel(l.name),
                  })),
                ]}
              />
            </>
          }
          advanced={
            <>
              <Sel
                label="القسم"
                value={deptId}
                onChange={(v) => {
                  setDeptId(v);
                  setProgId("all");
                  setLvlId("all");
                  setCohortId("all");
                  setDgId("all");
                }}
                items={[
                  { id: "all", name: "الكل" },
                  ...(depts ?? []).map((d) => ({ id: d.id, name: d.name })),
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
                  ...scopedCohorts.map((c) => ({ id: c.id, name: c.code ?? c.id })),
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
                  ...(rooms ?? []).map((r) => ({
                    id: r.id,
                    name: entityDisplayName(r),
                  })),
                ]}
              />
            </>
          }
        />
      }
    >
      <StudentScheduleTables rows={rows} />
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
    <ReportFilterField label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
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
    </ReportFilterField>
  );
}
