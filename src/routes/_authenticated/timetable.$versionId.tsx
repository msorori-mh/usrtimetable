/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight,
  Plus,
  Gauge,
  Activity,
  AlertTriangle,
  GripVertical,
  Printer,
} from "lucide-react";
import {
  TimetableGrid,
  type GridSession,
  type AvailabilityWindow,
  type DropPayload,
} from "@/components/timetable/timetable-grid";
import { SessionDialog } from "@/components/timetable/session-dialog";
import { DeliveryDemoWarningBanner } from "@/components/schedule/delivery-demo-warning-banner";
import {
  scoreScheduleVersion,
  type QualityResult,
} from "@/lib/conflict-engine/scorer";
import { validateProposed } from "@/lib/conflict-engine/validator";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";
import {
  SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR,
  SCHEDULE_BUILDER_NO_COLLEGE_AR,
  isScheduleVersionInActiveCollege,
  isSessionDialogReadOnly,
  resolveTimetableGridHours,
  shouldLoadScheduleBuilderData,
} from "@/lib/schedule-builder/access";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import { listScheduleBuilderV2WorkItems } from "@/lib/schedule-builder/v2-assignment-service";
import {
  buildTimetableLevelOptions,
  filterUnscheduledNewFlowWorkItems,
  groupTimetableSidebarItems,
  preserveTimetableLevelFilter,
  sessionMatchesTimetableAcademicFilters,
} from "@/lib/schedule-builder/timetable-editor-filters";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/timetable/$versionId")({
  head: () => ({ meta: [{ title: "بناء الجدول" }] }),
  component: TimetablePage,
});

const toMin = (s: string) => {
  const [h, m] = s.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
const addMin = (s: string, add: number) => {
  const total = toMin(s) + add;
  const h = Math.floor(total / 60) % 24,
    m = total % 60;
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
  const [gridStudy, setGridStudy] = useState<"regular" | "parallel" | "both">(
    "regular",
  );

  const {
    data: version,
    isLoading: versionLoading,
    isError: versionError,
  } = useQuery({
    queryKey: ["sv-detail", versionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, college_id, academic_term_id, notes")
        .eq("id", versionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const collegeMatches = isScheduleVersionInActiveCollege(version, active?.id);
  const canLoadData = shouldLoadScheduleBuilderData({
    hasActiveCollege: !!active,
    versionLoaded: !!version,
    collegeMatches,
  });

  const dialogReadOnly = isSessionDialogReadOnly({
    canManageRole,
    versionStatus: version?.status,
  });
  const canManage = !dialogReadOnly;

  const { data: sessions } = useQuery({
    queryKey: ["sessions-for-version", versionId, active?.id],
    enabled: canLoadData,
    queryFn: async () => {
      // Flat select + client hydrate — never nest courses() under course_offerings (PGRST200).
      return fetchHydratedVersionSessions({
        collegeId: active!.id,
        versionId,
        studySystem: "all",
      });
    },
  });

  const { data: lookups } = useQuery({
    queryKey: ["timetable-lookups", active?.id, version?.academic_term_id],
    enabled: canLoadData,
    queryFn: async () => {
      const [
        depts,
        progs,
        levels,
        instrs,
        rooms,
        offeringsRes,
        tas,
        templates,
        settings,
        roomTypes,
      ] = await Promise.all([
        supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id),
        supabase
          .from("academic_programs")
          .select("id, name, department_id")
          .eq("college_id", active!.id),
        supabase
          .from("academic_levels")
          .select("id, name, program_id, level_number")
          .eq("college_id", active!.id),
        supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id),
        supabase
          .from("rooms")
          .select("id, code, name, room_type_id")
          .eq("college_id", active!.id),
        // Flat offerings only — no nested courses() embed (PGRST200).
        supabase
          .from("course_offerings")
          .select(
            "id, course_id, program_id, level_id, expected_students, plan_course_id",
          )
          .eq("college_id", active!.id)
          .eq("term_id", version?.academic_term_id ?? ""),
        supabase
          .from("teaching_assignments")
          .select("id, course_offering_id, instructor_id")
          .eq("college_id", active!.id),
        supabase
          .from("time_slot_templates")
          .select("*")
          .eq("college_id", active!.id)
          .eq("is_active", true),
        supabase
          .from("scheduling_settings")
          .select("*")
          .eq("college_id", active!.id)
          .maybeSingle(),
        supabase
          .from("room_types")
          .select("id, name_ar")
          .eq("college_id", active!.id),
      ]);

      const offeringsFlat = offeringsRes.data ?? [];
      const courseIds = [
        ...new Set(
          offeringsFlat
            .map((o) => o.course_id as string | null)
            .filter((id): id is string => !!id),
        ),
      ];
      const { data: courseRows } = courseIds.length
        ? await supabase
            .from("courses")
            .select("id, code, name, department_id")
            .in("id", courseIds)
        : {
            data: [] as Array<{
              id: string;
              code: string | null;
              name: string | null;
              department_id: string | null;
            }>,
          };
      const courseById = new Map((courseRows ?? []).map((c) => [c.id, c]));
      const offerings = offeringsFlat.map((o) => {
        const course = courseById.get(o.course_id);
        return {
          ...o,
          courses: course
            ? {
                code: course.code,
                name: course.name,
                department_id: course.department_id,
              }
            : { code: "—", name: "مقرر غير متاح", department_id: null },
        };
      });

      return {
        depts: depts.data ?? [],
        progs: progs.data ?? [],
        levels: levels.data ?? [],
        instrs: instrs.data ?? [],
        rooms: rooms.data ?? [],
        offerings,
        tas: tas.data ?? [],
        templates: templates.data ?? [],
        settings: settings.data ?? null,
        roomTypes: roomTypes.data ?? [],
      };
    },
  });

  const { data: workItemsPayload } = useQuery({
    queryKey: ["timetable-v2-work-items", versionId, active?.id],
    enabled: canLoadData,
    queryFn: async () =>
      listScheduleBuilderV2WorkItems({ scheduleVersionId: versionId }),
  });

  const workingDays = lookups?.settings?.working_days ?? [6, 0, 1, 2, 3, 4];
  const { startHour, endHour } = useMemo(
    () =>
      resolveTimetableGridHours({
        settings: lookups?.settings ?? null,
        templates: lookups?.templates ?? [],
      }),
    [lookups?.settings, lookups?.templates],
  );

  const availability: AvailabilityWindow[] | undefined = useMemo(() => {
    const tpl = (lookups?.templates ?? []).filter(
      (t: any) =>
        t.study_system === gridStudy ||
        t.study_system === "both" ||
        gridStudy === "both",
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

  const levelOptions = useMemo(
    () =>
      buildTimetableLevelOptions({
        levels: lookups?.levels ?? [],
        programs: lookups?.progs ?? [],
        departmentId: fDept,
        programId: fProg,
      }),
    [lookups?.levels, lookups?.progs, fDept, fProg],
  );

  useEffect(() => {
    setFLevel((current) => preserveTimetableLevelFilter(current, levelOptions));
  }, [levelOptions]);

  const filtered = useMemo(() => {
    return (sessions ?? []).filter((s: any) => {
      if (
        !sessionMatchesTimetableAcademicFilters({
          session: s,
          departmentId: fDept,
          programId: fProg,
          levelValue: fLevel,
          levels: lookups?.levels ?? [],
        })
      ) {
        return false;
      }
      if (
        fInstr !== "all" &&
        s.instructor_id !== fInstr &&
        !s.intake_instructor_ids?.includes(fInstr)
      )
        return false;
      if (fRoom !== "all" && s.room_id !== fRoom) return false;
      if (fStudy !== "all" && s.study_system !== fStudy) return false;
      return true;
    });
  }, [sessions, fDept, fProg, fLevel, fInstr, fRoom, fStudy, lookups?.levels]);

  const gridSessions: GridSession[] = useMemo(
    () =>
      (filtered ?? []).map((s: any) => {
        const courseName = entityDisplayName(
          s.course_offerings?.courses ?? {},
          "مقرر غير متاح",
        );
        return {
          id: s.id,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          study_system: s.study_system,
          session_type: s.session_type,
          title: `${s.is_locked ? "🔒 " : ""}${courseName}`,
          subtitle: `${s.instructors?.full_name ?? ""}${s.rooms ? ` • ${entityDisplayName(s.rooms)}` : ""}${s.source_type === "auto_generated" ? " • تلقائي" : s.source_type === "cloned" ? " • منسوخ" : ""}`,
          badge:
            s.study_system === "parallel"
              ? "موازي"
              : s.study_system === "both"
                ? "م/م"
                : "انتظام",
        };
      }),
    [filtered],
  );

  // New Flow work items for this schedule version only — never all term offerings / Legacy.
  const unscheduled = useMemo(
    () =>
      filterUnscheduledNewFlowWorkItems({
        rows: workItemsPayload?.rows ?? [],
        programs: lookups?.progs ?? [],
        levels: lookups?.levels ?? [],
        departments: lookups?.depts ?? [],
        filters: {
          departmentId: fDept,
          programId: fProg,
          levelValue: fLevel,
          studySystem: fStudy,
          instructorId: fInstr,
        },
      }),
    [
      workItemsPayload?.rows,
      lookups?.progs,
      lookups?.levels,
      lookups?.depts,
      fDept,
      fProg,
      fLevel,
      fStudy,
      fInstr,
    ],
  );

  const grouped = useMemo(
    () => groupTimetableSidebarItems(unscheduled),
    [unscheduled],
  );

  const runQuality = async () => {
    if (!active || !canLoadData) return;
    setScoring(true);
    try {
      const { result } = await scoreScheduleVersion({
        collegeId: active.id,
        scheduleVersionId: versionId,
      });
      setQuality(result);
      toast.success(`الجودة: ${result.total_score}/100`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScoring(false);
    }
  };

  const handleDrop = async (params: {
    day: number;
    startTime: string;
    payload: DropPayload;
  }) => {
    if (!active || !canManage || !canLoadData) return;
    const { day, startTime, payload } = params;
    if (payload.kind === "unscheduled") {
      const item = unscheduled.find(
        (o) => o.course_offering_id === payload.id || o.key === payload.id,
      );
      if (!item) return;
      setEditId(null);
      setPrefill({
        course_offering_id: item.course_offering_id,
        teaching_assignment_id: item.teaching_assignment_id,
        instructor_id: item.instructor_id || "",
        study_system: item.study_system || gridStudy,
        day_of_week: day,
        start_time: startTime,
        end_time: addMin(startTime, 120),
        expected_students: item.expected_students ?? 0,
      });
      setDialogOpen(true);
      return;
    }
    const existing = (sessions ?? []).find((s: any) => s.id === payload.id);
    if (!existing) return;
    if (existing.is_locked) {
      toast.error("المحاضرة مقفلة — يجب فك القفل قبل التحريك");
      return;
    }
    const duration = toMin(existing.end_time) - toMin(existing.start_time);
    const newEnd = addMin(startTime, duration);
    const validation = await validateProposed({
      collegeId: active.id,
      scheduleVersionId: versionId,
      sessions: [
        {
          id: existing.id,
          course_offering_id: existing.course_offering_id ?? "",
          teaching_assignment_id: existing.teaching_assignment_id ?? null,
          instructor_id: existing.instructor_id ?? "",
          room_id: existing.room_id,
          section_id: existing.section_id,
          section_group_id: existing.section_group_id,
          study_system: existing.study_system as any,
          day_of_week: day,
          start_time: startTime,
          end_time: newEnd,
          session_type: existing.session_type ?? "lecture",
          expected_students: existing.expected_students ?? undefined,
        },
      ],
      excludeExistingSessionIds: [existing.id],
    });
    if (validation.unapprovedHardConflicts > 0) {
      toast.error(
        `⚠️ نقل مرفوض — ${validation.unapprovedHardConflicts} تعارض (${validation.conflicts[0].message_ar})`,
      );
      await logAudit({
        action: "blocked_conflict",
        entity: "schedule_sessions",
        entityId: existing.id,
        collegeId: active.id,
        details: { codes: validation.conflicts.map((c) => c.code) },
      });
      return;
    }
    const { error } = await supabase
      .from("schedule_sessions")
      .update({
        day_of_week: day,
        start_time: startTime,
        end_time: newEnd,
      })
      .eq("id", existing.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "drag_move",
      entity: "schedule_sessions",
      entityId: existing.id,
      collegeId: active.id,
      details: { day, start_time: startTime },
    });
    toast.success("تم نقل المحاضرة");
    qc.invalidateQueries({ queryKey: ["sessions-for-version", versionId] });
  };

  if (!active) {
    return (
      <div className="space-y-4" dir="rtl">
        <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {SCHEDULE_BUILDER_NO_COLLEGE_AR}
        </p>
        <Button variant="outline" asChild>
          <Link to="/schedule-versions">
            <ArrowRight className="h-4 w-4 ml-1" /> عودة للنسخ
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

  if (versionError || !version) {
    return (
      <div className="space-y-4" dir="rtl">
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          تعذّر تحميل نسخة الجدول.
        </p>
        <Button variant="outline" asChild>
          <Link to="/schedule-versions">
            <ArrowRight className="h-4 w-4 ml-1" /> عودة للنسخ
          </Link>
        </Button>
      </div>
    );
  }

  if (!collegeMatches) {
    return (
      <div className="space-y-4" dir="rtl">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/schedule-versions">
            <ArrowRight className="h-4 w-4 ml-1" /> عودة للنسخ
          </Link>
        </Button>
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          {SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR}
        </div>
      </div>
    );
  }

  const isLocked =
    version.status === "published" || version.status === "archived";

  return (
    <div className="space-y-4" dir="rtl">
      <DeliveryDemoWarningBanner name={version.name} notes={version.notes} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/schedule-versions">
              <ArrowRight className="h-4 w-4 ml-1" /> عودة للنسخ
            </Link>
          </Button>
          <h1 className="text-2xl font-bold mt-1">
            {version.name} <Badge variant="secondary">{version.status}</Badge>
          </h1>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <Label className="text-xs">عرض شبكة</Label>
            <Select
              value={gridStudy}
              onValueChange={(v) => setGridStudy(v as any)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">كلاهما</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" asChild>
            <Link to="/timetable/$versionId/print" params={{ versionId }}>
              <Printer className="h-4 w-4 ml-1" /> طباعة وتصدير الجدول
            </Link>
          </Button>
          <Button variant="outline" onClick={runQuality} disabled={scoring}>
            <Gauge className="h-4 w-4 ml-1" />{" "}
            {scoring ? "..." : "احتساب الجودة"}
          </Button>
          <Button
            disabled={!canManage}
            onClick={() => {
              setEditId(null);
              setPrefill(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 ml-1" /> محاضرة جديدة
          </Button>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm">
          🔒 هذه النسخة{" "}
          <strong>
            {version.status === "published" ? "منشورة" : "مؤرشفة"}
          </strong>{" "}
          — العرض للقراءة فقط. لا يمكن إضافة أو تعديل أو حذف المحاضرات.
        </div>
      )}

      {quality && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Gauge className="h-3 w-3" /> الجودة
            </div>
            <div className="text-3xl font-bold">{quality.total_score}/100</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> تعارضات إلزامية
            </div>
            <div className="text-3xl font-bold">
              {quality.hard_conflicts_count}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-amber-600 flex items-center gap-1">
              <Activity className="h-3 w-3" /> مخالفات مرنة
            </div>
            <div className="text-3xl font-bold">
              {quality.soft_conflicts_count}
            </div>
          </Card>
        </div>
      )}

      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div>
            <Label className="text-xs">القسم</Label>
            <Select value={fDept} onValueChange={setFDept}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {lookups?.depts.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">البرنامج</Label>
            <Select value={fProg} onValueChange={setFProg}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {lookups?.progs.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">المستوى</Label>
            <Select value={fLevel} onValueChange={setFLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {levelOptions.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">المحاضر</Label>
            <Select value={fInstr} onValueChange={setFInstr}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {lookups?.instrs.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">القاعة</Label>
            <Select value={fRoom} onValueChange={setFRoom}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {lookups?.rooms.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {entityDisplayName(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">نظام (تصفية)</Label>
            <Select value={fStudy} onValueChange={setFStudy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="regular">انتظام</SelectItem>
                <SelectItem value="parallel">موازي</SelectItem>
                <SelectItem value="both">كلاهما</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            onSessionClick={(id) => {
              setEditId(id);
              setPrefill(undefined);
              setDialogOpen(true);
            }}
            onDropAt={handleDrop}
          />
        </div>
        <Card className="p-3 max-h-[700px] overflow-auto">
          <div className="font-semibold mb-2 text-sm">
            عناصر غير مجدولة ({unscheduled.length})
          </div>
          <Accordion type="multiple" className="w-full">
            {Array.from(grouped.entries()).map(([dept, progMap]) => (
              <AccordionItem key={dept} value={dept}>
                <AccordionTrigger className="text-xs">{dept}</AccordionTrigger>
                <AccordionContent>
                  {Array.from(progMap.entries()).map(([prog, lvlMap]) => (
                    <div key={prog} className="mb-2">
                      <div className="text-[11px] font-medium text-muted-foreground mb-1">
                        {prog}
                      </div>
                      {Array.from(lvlMap.entries()).map(([lvl, items]) => (
                        <div key={lvl} className="pr-2">
                          <div className="text-[10px] text-muted-foreground">
                            {lvl}
                          </div>
                          <div className="space-y-1">
                            {items.map((item) => (
                              <div
                                key={item.key}
                                draggable={canManage}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    "application/x-lovable-drop",
                                    JSON.stringify({
                                      kind: "unscheduled",
                                      id: item.course_offering_id,
                                    }),
                                  );
                                  e.dataTransfer.effectAllowed = "copy";
                                }}
                                className="border rounded p-2 text-xs bg-card hover:bg-accent/30 cursor-grab active:cursor-grabbing"
                              >
                                <div className="flex items-start gap-1">
                                  <GripVertical className="h-3 w-3 mt-0.5 text-muted-foreground" />
                                  <div className="flex-1">
                                    <div className="font-medium">
                                      {entityDisplayName({
                                        name: item.course_name,
                                        code: item.course_code,
                                      })}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      المحاضر: {item.instructor_name}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      الطلاب المتوقعون:{" "}
                                      {item.expected_students ?? 0}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {unscheduled.length === 0 && (
            <div className="text-xs text-muted-foreground">لا توجد عناصر.</div>
          )}
        </Card>
      </div>

      <SessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        collegeId={active.id}
        scheduleVersionId={versionId}
        sessionId={editId}
        defaults={prefill}
        readOnly={dialogReadOnly}
      />
    </div>
  );
}
