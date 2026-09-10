import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, FileSpreadsheet, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeliveryDemoWarningBanner } from "@/components/schedule/delivery-demo-warning-banner";
import { PrintSheet } from "@/components/print-center/print-sheet";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";
import { downloadCSV, downloadXLSX } from "@/lib/reports/export";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import {
  isScheduleVersionInActiveCollege,
  SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR,
  SCHEDULE_BUILDER_NO_COLLEGE_AR,
} from "@/lib/schedule-builder/access";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import {
  DEFAULT_PRINT_VISIBILITY,
  PRINT_EXPORT_HEADERS,
  REPORT_TYPE_LABELS_AR,
  buildExportRows,
  buildPrintQrUrl,
  departmentFiltersComplete,
  filterPrintSessions,
  filtersToQrParams,
  groupPrintPages,
  latestSessionUpdate,
  levelFiltersComplete,
  parsePrintSearchParams,
  PRINT_PAGE_STYLE_ELEMENT_ID,
  PRINT_REQUEST_DISPATCHED_AR,
  printPageStyleCss,
  requestPrint,
  programFiltersComplete,
  studentFiltersComplete,
  type PrintCenterFilters,
  type PrintOrientation,
  type PrintPaperSize,
  type PrintReportType,
  type PrintSessionLike,
  type PrintStudySystem,
  type PrintVisibilityOptions,
} from "@/lib/print-center";

function Sel({
  label,
  value,
  onChange,
  items,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm py-1">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function PrintCenterPage(props: { versionId: string }) {
  const { versionId } = props;
  const { active } = useActiveCollege();
  const exportAt = useMemo(() => new Date(), []);

  const initialFromUrl = useMemo(() => {
    if (typeof window === "undefined") return {};
    return parsePrintSearchParams(new URLSearchParams(window.location.search));
  }, []);

  const [reportType, setReportType] = useState<PrintReportType>(
    initialFromUrl.reportType ?? "student",
  );
  const [programId, setProgramId] = useState(initialFromUrl.programId ?? "");
  const [levelId, setLevelId] = useState(initialFromUrl.levelId ?? "");
  const [studySystem, setStudySystem] = useState<PrintStudySystem>(
    (initialFromUrl.studySystem as PrintStudySystem) ??
      (initialFromUrl.reportType === "room" || initialFromUrl.reportType === "instructor" ? "all" : "regular"),
  );
  const [departmentId, setDepartmentId] = useState(initialFromUrl.departmentId ?? "");
  const [instructorId, setInstructorId] = useState(initialFromUrl.instructorId ?? "");
  const [roomId, setRoomId] = useState(initialFromUrl.roomId ?? "");
  const [paper, setPaper] = useState<PrintPaperSize>(initialFromUrl.paper ?? "A3");
  const [orientation, setOrientation] = useState<PrintOrientation>(
    initialFromUrl.orientation ?? "landscape",
  );
  const [visibility, setVisibility] = useState<PrintVisibilityOptions>(DEFAULT_PRINT_VISIBILITY);

  // Student default: A3 landscape (already set). Sync paper defaults when switching report type.
  useEffect(() => {
    if (reportType === "student") {
      setPaper((p) => (initialFromUrl.paper ? p : "A3"));
      setOrientation((o) => (initialFromUrl.orientation ? o : "landscape"));
    }
  }, [reportType, initialFromUrl.paper, initialFromUrl.orientation]);

  // Clear leftover dimensions that do not apply to the active report type
  // (e.g. programId from student must not shrink instructor/room reports).
  useEffect(() => {
    if (reportType === "instructor" || reportType === "room") {
      setProgramId("");
      setLevelId("");
      setDepartmentId("");
    }
    if (reportType === "instructor") {
      setRoomId("");
    }
    if (reportType === "room") {
      setInstructorId("");
    }
    if (reportType === "level") {
      setProgramId("");
      setDepartmentId("");
      setInstructorId("");
      setRoomId("");
    }
  }, [reportType]);

  const { data: version, isLoading: versionLoading } = useQuery({
    queryKey: ["print-center-version", versionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, college_id, academic_term_id, notes, updated_at")
        .eq("id", versionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const collegeMatches = isScheduleVersionInActiveCollege(version, active?.id);

  const { data: term } = useQuery({
    queryKey: ["print-center-term", version?.academic_term_id, active?.id],
    enabled: !!version?.academic_term_id && !!active && collegeMatches,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name")
        .eq("id", version!.academic_term_id!)
        .eq("college_id", active!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: depts } = useQuery({
    queryKey: ["print-center-depts", active?.id],
    enabled: !!active && collegeMatches,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });
  const { data: progs } = useQuery({
    queryKey: ["print-center-progs", active?.id, departmentId],
    enabled: !!active && collegeMatches,
    queryFn: async () => {
      let q = supabase
        .from("academic_programs")
        .select("id, name, department_id")
        .eq("college_id", active!.id)
        .order("name");
      if (departmentId) q = q.eq("department_id", departmentId);
      return (await q).data ?? [];
    },
  });
  const { data: levels } = useQuery({
    queryKey: ["print-center-levels", active?.id],
    enabled: !!active && collegeMatches,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name, level_number, program_id")
          .eq("college_id", active!.id)
          .order("level_number")
      ).data ?? [],
  });
  const { data: instructors } = useQuery({
    queryKey: ["print-center-ins", active?.id],
    enabled: !!active && collegeMatches,
    queryFn: async () =>
      (
        await supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .order("full_name")
      ).data ?? [],
  });
  const { data: rooms } = useQuery({
    queryKey: ["print-center-rooms", active?.id],
    enabled: !!active && collegeMatches,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, code, name")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? [],
  });

  const filters: PrintCenterFilters = useMemo(
    () => ({
      reportType,
      collegeId: active?.id ?? "",
      programId: programId || null,
      levelId: levelId || null,
      studySystem,
      departmentId: departmentId || null,
      instructorId: instructorId || null,
      roomId: roomId || null,
    }),
    [reportType, active?.id, programId, levelId, studySystem, departmentId, instructorId, roomId],
  );

  const studentReady = studentFiltersComplete(filters);
  const filtersReady =
    studentReady &&
    departmentFiltersComplete(filters) &&
    programFiltersComplete(filters) &&
    levelFiltersComplete(filters);

  const { data: sessionsBundle, isLoading: sessionsLoading } = useQuery({
    queryKey: ["print-center-sessions", versionId, active?.id, filters],
    enabled: !!active && collegeMatches && !!version && filtersReady,
    queryFn: async () => {
      const hydrated = await fetchHydratedVersionSessions({
        collegeId: active!.id,
        versionId,
        studySystem: "all",
      });
      // Stamp college_id for pure filter cross-college guard (query already scoped).
      const stamped: PrintSessionLike[] = hydrated.map((s) => ({
        ...s,
        college_id: active!.id,
      }));
      const filtered = filterPrintSessions(stamped, filters);
      const labels = await fetchCohortDeliveryGroupLabels(active!.id, filtered);
      return { sessions: filtered, labels };
    },
  });

  const pages = useMemo(() => {
    if (!sessionsBundle?.sessions) return [];
    return groupPrintPages(sessionsBundle.sessions, filters);
  }, [sessionsBundle, filters]);

  const exportRows = useMemo(
    () => buildExportRows(pages, sessionsBundle?.labels),
    [pages, sessionsBundle?.labels],
  );

  const qrUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return buildPrintQrUrl(origin, filtersToQrParams(versionId, filters, paper, orientation));
  }, [versionId, filters, paper, orientation]);

  // Inject @page size for A4/A3 landscape/portrait (cannot nest @page in CSS selectors).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = PRINT_PAGE_STYLE_ELEMENT_ID;
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = printPageStyleCss(paper, orientation);
    return () => {
      el?.remove();
    };
  }, [paper, orientation]);

  // Keep URL in sync for shareable/QR links (no navigation).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = filtersToQrParams(versionId, filters, paper, orientation);
    const qs = new URLSearchParams();
    qs.set("type", params.reportType);
    if (params.programId) qs.set("program", params.programId);
    if (params.levelId) qs.set("level", params.levelId);
    if (params.studySystem) qs.set("study", params.studySystem);
    if (params.departmentId) qs.set("dept", params.departmentId);
    if (params.instructorId) qs.set("instructor", params.instructorId);
    if (params.roomId) qs.set("room", params.roomId);
    if (params.paper) qs.set("paper", params.paper);
    if (params.orientation) qs.set("orient", params.orientation);
    const next = `${window.location.pathname}?${qs.toString()}`;
    window.history.replaceState(null, "", next);
  }, [versionId, filters, paper, orientation]);

  const isDemo = isDeliveryDemoVersion({ name: version?.name, notes: version?.notes });
  const lastUpdate = latestSessionUpdate(sessionsBundle?.sessions ?? []) ?? version?.updated_at;

  const setVis = <K extends keyof PrintVisibilityOptions>(
    key: K,
    value: PrintVisibilityOptions[K],
  ) => {
    setVisibility((v) => ({ ...v, [key]: value }));
  };

  const filename = `timetable_print_${versionId}_${reportType}`;

  // LAUNCH-CLOSURE print diagnosis: keep window.print() as the only print mechanism,
  // but surface an actionable Arabic status instead of a dead-looking button.
  const handlePrintClick = () => {
    const result = requestPrint(typeof window === "undefined" ? null : window);
    if (result.status === "dispatched") {
      toast.info(PRINT_REQUEST_DISPATCHED_AR);
      return;
    }
    toast.error(result.message);
  };

  if (!active) {
    return (
      <div className="space-y-4" dir="rtl">
        <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {SCHEDULE_BUILDER_NO_COLLEGE_AR}
        </p>
        <Button variant="outline" asChild>
          <Link to="/timetable/$versionId" params={{ versionId }}>
            <ArrowRight className="h-4 w-4 ml-1" /> عودة للمحرر
          </Link>
        </Button>
      </div>
    );
  }

  if (versionLoading) {
    return (
      <p className="p-6 text-center text-muted-foreground" dir="rtl">
        جارٍ التحميل...
      </p>
    );
  }

  if (!version || !collegeMatches) {
    return (
      <div className="space-y-4" dir="rtl">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/timetable/$versionId" params={{ versionId }}>
            <ArrowRight className="h-4 w-4 ml-1" /> عودة للمحرر
          </Link>
        </Button>
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          {SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`print-center-root report-print-root space-y-4 print-paper-${paper.toLowerCase()} print-orient-${orientation}`}
      dir="rtl"
      data-paper={paper}
      data-orientation={orientation}
    >
      <div className="report-no-print space-y-4">
        <DeliveryDemoWarningBanner name={version.name} notes={version.notes} />

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/timetable/$versionId" params={{ versionId }}>
                <ArrowRight className="h-4 w-4 ml-1" /> عودة لمحرر الجدول
              </Link>
            </Button>
            <h1 className="text-2xl font-bold mt-1">مركز الطباعة والتصدير</h1>
            <p className="text-sm text-muted-foreground">
              {version.name} · قراءة فقط · بدون تعديل على الجلسات
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintClick}
              disabled={pages.length === 0}
            >
              <Printer className="h-4 w-4 ml-1" /> طباعة
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!exportRows.length}
              onClick={() =>
                downloadCSV(
                  exportRows as unknown as Record<string, unknown>[],
                  PRINT_EXPORT_HEADERS.map((h) => ({ key: h.key, label: h.label })),
                  filename,
                )
              }
            >
              <Download className="h-4 w-4 ml-1" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!exportRows.length}
              onClick={() =>
                downloadXLSX(
                  exportRows as unknown as Record<string, unknown>[],
                  PRINT_EXPORT_HEADERS.map((h) => ({ key: h.key, label: h.label })),
                  filename,
                )
              }
            >
              <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
            </Button>
          </div>
        </div>

        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Sel
              label="نوع التقرير"
              value={reportType}
              onChange={(v) => {
                setReportType(v as PrintReportType);
                if (v === "room" || v === "instructor") setStudySystem("all");
                if (v === "student" && studySystem === "all") setStudySystem("regular");
              }
              items={(Object.keys(REPORT_TYPE_LABELS_AR) as PrintReportType[]).map((k) => ({
                id: k,
                name: REPORT_TYPE_LABELS_AR[k],
              }))}
            />
            {(reportType === "department" ||
              reportType === "student" ||
              reportType === "program") && (
              <Sel
                label="القسم"
                value={departmentId || "__all__"}
                onChange={(v) => {
                  setDepartmentId(v === "__all__" ? "" : v);
                  if (v !== "__all__") setProgramId("");
                }}
                items={[
                  { id: "__all__", name: reportType === "department" ? "اختر القسم" : "الكل" },
                  ...(depts ?? []).map((d) => ({ id: d.id, name: d.name })),
                ]}
              />
            )}
            {(reportType === "student" ||
              reportType === "program" ||
              reportType === "level" ||
              reportType === "department") && (
              <Sel
                label="البرنامج"
                value={programId || "__all__"}
                onChange={(v) => {
                  setProgramId(v === "__all__" ? "" : v);
                  setLevelId("");
                }}
                items={[
                  {
                    id: "__all__",
                    name:
                      reportType === "student" || reportType === "program"
                        ? "اختر البرنامج"
                        : "الكل",
                  },
                  ...(progs ?? []).map((p) => ({ id: p.id, name: p.name })),
                ]}
              />
            )}
            {(reportType === "student" || reportType === "level") && (
              <Sel
                label="المستوى"
                value={levelId || "__all__"}
                onChange={(v) => setLevelId(v === "__all__" ? "" : v)}
                items={[
                  { id: "__all__", name: "اختر المستوى" },
                  ...(levels ?? [])
                    .filter((l) => !programId || l.program_id === programId)
                    .map((l) => ({ id: l.id, name: l.name })),
                ]}
              />
            )}
            {(
              <Sel
                label="النظام الدراسي"
                value={studySystem}
                onChange={(v) => setStudySystem(v as PrintStudySystem)}
                items={[
                  { id: "regular", name: STUDY_SYSTEM_LABELS.regular },
                  { id: "parallel", name: STUDY_SYSTEM_LABELS.parallel },
                  ...(reportType === "student"
                    ? []
                    : [{ id: "all", name: STUDY_SYSTEM_LABELS.all }]),
                ]}
              />
            )}
            {reportType === "instructor" && (
              <Sel
                label="المدرس"
                value={instructorId || "__all__"}
                onChange={(v) => setInstructorId(v === "__all__" ? "" : v)}
                items={[
                  { id: "__all__", name: "كل المدرسين" },
                  ...(instructors ?? []).map((i) => ({ id: i.id, name: i.full_name })),
                ]}
              />
            )}
            {reportType === "room" && (
              <Sel
                label="القاعة"
                value={roomId || "__all__"}
                onChange={(v) => setRoomId(v === "__all__" ? "" : v)}
                items={[
                  { id: "__all__", name: "كل القاعات" },
                  ...(rooms ?? []).map((r) => ({
                    id: r.id,
                    name: `${r.code ?? ""} ${r.name ?? ""}`.trim(),
                  })),
                ]}
              />
            )}
            <Sel
              label="حجم الورق"
              value={paper}
              onChange={(v) => setPaper(v as PrintPaperSize)}
              items={[
                { id: "A3", name: "A3" },
                { id: "A4", name: "A4" },
              ]}
            />
            <Sel
              label="الاتجاه"
              value={orientation}
              onChange={(v) => setOrientation(v as PrintOrientation)}
              items={[
                { id: "landscape", name: "أفقي" },
                { id: "portrait", name: "عمودي" },
              ]}
            />
          </div>

          {reportType === "student" && !studentReady && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              جدول الطلاب يتطلب اختيار البرنامج والمستوى والنظام الدراسي (انتظام أو موازي).
            </p>
          )}

          {reportType === "department" && !departmentId && (
            <p className="text-sm text-muted-foreground">اختر قسمًا لعرض برامجه في صفحات منفصلة.</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1 border-t pt-3">
            <Toggle
              label="شعار الجامعة"
              checked={visibility.showUniversityLogo}
              onChange={(v) => setVis("showUniversityLogo", v)}
            />
            <Toggle
              label="الكلية"
              checked={visibility.showCollege}
              onChange={(v) => setVis("showCollege", v)}
            />
            <Toggle
              label="القسم"
              checked={visibility.showDepartment}
              onChange={(v) => setVis("showDepartment", v)}
            />
            <Toggle
              label="البرنامج"
              checked={visibility.showProgram}
              onChange={(v) => setVis("showProgram", v)}
            />
            <Toggle
              label="المستوى"
              checked={visibility.showLevel}
              onChange={(v) => setVis("showLevel", v)}
            />
            <Toggle
              label="النظام الدراسي"
              checked={visibility.showStudySystem}
              onChange={(v) => setVis("showStudySystem", v)}
            />
            <Toggle
              label="المدرس"
              checked={visibility.showInstructor}
              onChange={(v) => setVis("showInstructor", v)}
            />
            <Toggle
              label="القاعة"
              checked={visibility.showRoom}
              onChange={(v) => setVis("showRoom", v)}
            />
            <Toggle label="QR" checked={visibility.showQr} onChange={(v) => setVis("showQr", v)} />
            <Toggle
              label="تاريخ التصدير"
              checked={visibility.showExportDate}
              onChange={(v) => setVis("showExportDate", v)}
            />
            <Toggle
              label="حالة النسخة"
              checked={visibility.showVersionStatus}
              onChange={(v) => setVis("showVersionStatus", v)}
            />
            <Toggle
              label="رقم النسخة"
              checked={visibility.showVersionNumber}
              onChange={(v) => setVis("showVersionNumber", v)}
            />
          </div>
        </Card>
      </div>

      <div className="report-print-body print-center-body space-y-6">
        {sessionsLoading ? (
          <Card className="p-8 text-center text-muted-foreground report-no-print">
            جارٍ التحميل…
          </Card>
        ) : pages.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground report-no-print">
            لا توجد جلسات مطابقة للفلاتر الحالية.
          </Card>
        ) : (
          pages.map((page, idx) => (
            <PrintSheet
              key={page.key}
              page={page}
              visibility={visibility}
              labels={sessionsBundle?.labels}
              meta={{
                collegeName: active.name,
                departmentName:
                  (depts ?? []).find((d) => d.id === departmentId)?.name ??
                  page.departmentName ??
                  null,
                programName:
                  (progs ?? []).find((p) => p.id === programId)?.name ?? page.programName ?? null,
                levelName:
                  (levels ?? []).find((l) => l.id === levelId)?.name ?? page.levelName ?? null,
                studySystem: page.studySystem ?? studySystem,
                termName: term?.name ?? null,
                versionName: version.name,
                versionStatus: version.status as SVStatus,
                versionNumber: version.name,
                exportAt,
                lastUpdate: lastUpdate ?? null,
                qrUrl,
                isDemo,
                pageIndex: idx + 1,
                pageCount: pages.length,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
