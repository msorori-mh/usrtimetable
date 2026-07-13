/**
 * Schedule Builder workspace — read model + Phase A local edit state/UI.
 * Pending changes stay in page state only. No mutations, scheduler, publish, or drag-and-drop.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TimetableGrid } from "@/components/timetable/timetable-grid";
import { SessionDetailsSheet } from "@/components/schedule-builder/session-details-sheet";
import { SessionEditSheet } from "@/components/schedule-builder/session-edit-sheet";
import { UnsavedLocalChangesDialog } from "@/components/schedule-builder/unsaved-local-changes-dialog";
import {
  SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_COLLEGE_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR,
  isScheduleVersionWriteLocked,
  resolveTimetableGridHours,
  shouldLoadWorkspaceCollegeScoped,
  shouldLoadWorkspaceSessions,
  shouldLoadWorkspaceVersions,
  type ScheduleVersionStatus,
} from "@/lib/schedule-builder/access";
import {
  canEnterEditMode,
  canOpenSessionForLocalEdit,
  editModeBlockedReason,
  SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR,
  SCHEDULE_BUILDER_UNSAVED_BADGE_AR,
  SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR,
} from "@/lib/schedule-builder/edit-access";
import {
  applyPendingToSessions,
  buildPendingChange,
  hasPendingChanges,
  toGridSessionsWithPending,
  validateLocalEditForm,
  type LocalEditFormValues,
  type PendingScheduleSessionChange,
} from "@/lib/schedule-builder/pending-change";
import {
  fetchWorkspaceRooms,
  fetchWorkspaceSchedulingSettings,
  fetchWorkspaceSessions,
  fetchWorkspaceTerms,
  fetchWorkspaceTimeTemplates,
  fetchWorkspaceVersions,
  type WorkspaceStudySystem,
} from "@/lib/schedule-builder/queries";
import {
  EMPTY_WORKSPACE_FILTERS,
  buildFilterOptions,
  computeWorkspaceStats,
  filterWorkspaceSessions,
  mapWorkspaceSessions,
  type WorkspaceFilters,
  type WorkspaceSessionView,
} from "@/lib/schedule-builder/workspace";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LABEL_AR,
  type SVStatus,
} from "@/lib/schedule-versions/lifecycle";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { AlertCircle, CalendarRange, Pencil, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedule-builder")({
  head: () => ({ meta: [{ title: "بناء الجدول" }] }),
  component: ScheduleBuilderWorkspacePage,
});

const DEFAULT_WORKING_DAYS = [6, 0, 1, 2, 3, 4];

type PendingAction =
  | { kind: "exit-edit" }
  | { kind: "set-term"; termId: string }
  | { kind: "set-version"; versionId: string }
  | { kind: "set-study-system"; studySystem: WorkspaceStudySystem };

function formatUpdatedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function ScheduleBuilderWorkspacePage() {
  const { active } = useActiveCollege();
  const canManageRole = useCanManageActiveCollege();
  const collegeId = active?.id ?? null;
  const canLoadCollege = shouldLoadWorkspaceCollegeScoped(!!collegeId);

  const [termId, setTermId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [studySystem, setStudySystem] = useState<WorkspaceStudySystem>("regular");
  const [filters, setFilters] = useState<WorkspaceFilters>(EMPTY_WORKSPACE_FILTERS);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editModeActive, setEditModeActive] = useState(false);
  const [pending, setPending] = useState<PendingScheduleSessionChange | null>(null);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const clearLocalEditState = useCallback(() => {
    setPending(null);
    setSelectedSessionId(null);
    setDetailsOpen(false);
    setEditSheetOpen(false);
  }, []);

  const discardPendingKeepEdit = useCallback(() => {
    setPending(null);
    setEditSheetOpen(false);
  }, []);

  // Reset local selection when college changes (page-local only — no DB write).
  useEffect(() => {
    setTermId(null);
    setVersionId(null);
    setFilters(EMPTY_WORKSPACE_FILTERS);
    setEditModeActive(false);
    clearLocalEditState();
  }, [collegeId, clearLocalEditState]);

  const termsQuery = useQuery({
    queryKey: ["schedule-builder", "terms", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceTerms(collegeId!),
  });

  useEffect(() => {
    if (!termsQuery.data?.length) return;
    if (termId && termsQuery.data.some((t) => t.id === termId)) return;
    const activeTerm = termsQuery.data.find((t) => t.is_active);
    setTermId(activeTerm?.id ?? termsQuery.data[0].id);
  }, [termsQuery.data, termId]);

  const canLoadVersions = shouldLoadWorkspaceVersions({
    hasActiveCollege: canLoadCollege,
    termId,
  });

  const versionsQuery = useQuery({
    queryKey: ["schedule-builder", "versions", collegeId, termId],
    enabled: canLoadVersions,
    queryFn: () => fetchWorkspaceVersions({ collegeId: collegeId!, termId: termId! }),
  });

  useEffect(() => {
    if (!versionsQuery.data) return;
    if (versionsQuery.data.length === 0) {
      setVersionId(null);
      return;
    }
    if (versionId && versionsQuery.data.some((v) => v.id === versionId)) return;
    setVersionId(versionsQuery.data[0].id);
  }, [versionsQuery.data, versionId, termId]);

  const canLoadSessions = shouldLoadWorkspaceSessions({
    hasActiveCollege: canLoadCollege,
    termId,
    versionId,
  });

  const sessionsQuery = useQuery({
    queryKey: ["schedule-builder", "sessions", collegeId, versionId, studySystem],
    enabled: canLoadSessions,
    queryFn: () =>
      fetchWorkspaceSessions({
        collegeId: collegeId!,
        versionId: versionId!,
        studySystem,
      }),
  });

  const roomsQuery = useQuery({
    queryKey: ["schedule-builder", "rooms", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceRooms(collegeId!),
  });

  const settingsQuery = useQuery({
    queryKey: ["schedule-builder", "settings", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceSchedulingSettings(collegeId!),
  });

  const templatesQuery = useQuery({
    queryKey: ["schedule-builder", "templates", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceTimeTemplates(collegeId!),
  });

  const workingDays = settingsQuery.data?.working_days?.length
    ? settingsQuery.data.working_days
    : DEFAULT_WORKING_DAYS;

  const { startHour, endHour } = useMemo(
    () =>
      resolveTimetableGridHours({
        settings: settingsQuery.data ?? null,
        templates: templatesQuery.data ?? [],
      }),
    [settingsQuery.data, templatesQuery.data],
  );

  const allSessions = useMemo(
    () => mapWorkspaceSessions(sessionsQuery.data ?? []),
    [sessionsQuery.data],
  );

  const rooms = roomsQuery.data ?? [];

  const displaySessions = useMemo(
    () => applyPendingToSessions(allSessions, pending, rooms),
    [allSessions, pending, rooms],
  );

  const filterOptions = useMemo(() => buildFilterOptions(displaySessions), [displaySessions]);

  const filteredSessions = useMemo(
    () => filterWorkspaceSessions(displaySessions, filters),
    [displaySessions, filters],
  );

  const gridSessions = useMemo(
    () =>
      toGridSessionsWithPending(
        filteredSessions,
        pending,
        editModeActive ? selectedSessionId : null,
      ),
    [filteredSessions, pending, editModeActive, selectedSessionId],
  );

  const stats = useMemo(() => computeWorkspaceStats(allSessions), [allSessions]);

  const selectedSession: WorkspaceSessionView | null = useMemo(() => {
    if (!selectedSessionId) return null;
    return displaySessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [displaySessions, selectedSessionId]);

  const originalSelectedSession: WorkspaceSessionView | null = useMemo(() => {
    if (!selectedSessionId) return null;
    return allSessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [allSessions, selectedSessionId]);

  const selectedVersion = versionsQuery.data?.find((v) => v.id === versionId) ?? null;
  const versionStatus = (selectedVersion?.status ?? null) as ScheduleVersionStatus | null;
  const versionWriteLocked = isScheduleVersionWriteLocked(versionStatus);

  const mayEnterEdit = canEnterEditMode({
    canManageRole,
    hasActiveCollege: !!collegeId,
    versionId,
    versionStatus,
  });

  const editBlockedReason = editModeBlockedReason({
    canManageRole,
    hasActiveCollege: !!collegeId,
    versionId,
    versionStatus,
  });

  // Drop edit mode if context becomes non-editable (e.g. auto-selected published version).
  useEffect(() => {
    if (editModeActive && !mayEnterEdit) {
      setEditModeActive(false);
      clearLocalEditState();
    }
  }, [editModeActive, mayEnterEdit, clearLocalEditState]);

  // Warn on browser refresh/close when local pending exists.
  useEffect(() => {
    if (!hasPendingChanges(pending)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending]);

  const requestWithUnsavedGuard = (action: PendingAction) => {
    if (hasPendingChanges(pending)) {
      setPendingAction(action);
      setUnsavedOpen(true);
      return;
    }
    runPendingAction(action);
  };

  const runPendingAction = (action: PendingAction) => {
    switch (action.kind) {
      case "exit-edit":
        setEditModeActive(false);
        clearLocalEditState();
        break;
      case "set-term":
        setTermId(action.termId);
        setVersionId(null);
        setFilters(EMPTY_WORKSPACE_FILTERS);
        setEditModeActive(false);
        clearLocalEditState();
        break;
      case "set-version":
        setVersionId(action.versionId);
        setFilters(EMPTY_WORKSPACE_FILTERS);
        clearLocalEditState();
        break;
      case "set-study-system":
        setStudySystem(action.studySystem);
        setFilters(EMPTY_WORKSPACE_FILTERS);
        clearLocalEditState();
        break;
    }
  };

  const onSessionClick = (id: string) => {
    const session = allSessions.find((s) => s.id === id) ?? null;
    if (
      editModeActive &&
      canOpenSessionForLocalEdit({
        editModeActive: true,
        canEnterEdit: mayEnterEdit,
        session,
      })
    ) {
      setSelectedSessionId(id);
      setDetailsOpen(false);
      setEditSheetOpen(true);
      return;
    }
    setSelectedSessionId(id);
    setEditSheetOpen(false);
    setDetailsOpen(true);
  };

  const toggleEditMode = () => {
    if (editModeActive) {
      requestWithUnsavedGuard({ kind: "exit-edit" });
      return;
    }
    if (!mayEnterEdit) return;
    setEditModeActive(true);
    setDetailsOpen(false);
    setEditSheetOpen(false);
    setSelectedSessionId(null);
  };

  const onApplyLocal = (form: LocalEditFormValues) => {
    if (!mayEnterEdit || !editModeActive) {
      return { ok: false as const, message: "وضع التعديل غير متاح." };
    }
    const base = originalSelectedSession;
    if (!base) return { ok: false as const, message: "لم تُحدد جلسة." };
    if (base.is_locked) {
      return { ok: false as const, message: "هذه الجلسة مقفلة ولا يمكن تعديلها محليًا." };
    }
    const validated = validateLocalEditForm(form, {
      day_of_week: base.day_of_week,
      start_time: base.start_time,
      end_time: base.end_time,
      room_id: base.room_id,
    });
    if (!validated.ok) return validated;
    setPending(
      buildPendingChange({
        session: base,
        proposed: validated.proposed,
        changeReason: validated.changeReason,
      }),
    );
    return { ok: true as const };
  };

  const onCancelSessionChange = () => {
    setPending(null);
  };

  const onCancelAllChanges = () => {
    setPending(null);
    setEditSheetOpen(false);
  };

  const resetFilters = () => setFilters(EMPTY_WORKSPACE_FILTERS);

  const setFilter = <K extends keyof WorkspaceFilters>(key: K, value: WorkspaceFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  if (!collegeId) {
    return (
      <div className="p-6" dir="rtl">
        <EmptyState
          icon={<CalendarRange className="h-8 w-8 text-muted-foreground" />}
          title="بناء الجدول"
          message={SCHEDULE_BUILDER_WORKSPACE_NO_COLLEGE_AR}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">بناء الجدول</h1>
          <p className="text-sm text-muted-foreground">
            مساحة عمل لعرض الجدول مع وضع تعديل محلي غير محفوظ — دون كتابة على قاعدة البيانات في هذه
            المرحلة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editModeActive ? (
            <Badge variant="secondary" className="gap-1">
              <Pencil className="h-3 w-3" aria-hidden />
              وضع التعديل
            </Badge>
          ) : null}
          {hasPendingChanges(pending) ? (
            <Badge variant="destructive" aria-label={SCHEDULE_BUILDER_UNSAVED_BADGE_AR}>
              {SCHEDULE_BUILDER_UNSAVED_BADGE_AR}
            </Badge>
          ) : null}
          {canManageRole ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant={editModeActive ? "secondary" : "default"}
                      disabled={!editModeActive && !mayEnterEdit}
                      onClick={toggleEditMode}
                      aria-disabled={!editModeActive && !mayEnterEdit}
                    >
                      {editModeActive
                        ? SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR
                        : SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!editModeActive && editBlockedReason ? (
                  <TooltipContent side="bottom" className="max-w-xs">
                    {editBlockedReason}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {hasPendingChanges(pending) ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancelAllChanges}>
              إلغاء جميع التغييرات
            </Button>
          ) : null}
        </div>
      </header>

      {versionWriteLocked && selectedVersion ? (
        <div
          className="rounded-md border border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm"
          role="status"
        >
          {SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR}
        </div>
      ) : null}

      {editModeActive ? (
        <div
          className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          انقر جلسة لفتح لوحة التعديل المحلي. {SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR}
        </div>
      ) : null}

      {/* Context bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">سياق الجدول</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الفصل الدراسي</Label>
            {termsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : termsQuery.isError ? (
              <ErrorInline message="تعذّر تحميل الفصول الدراسية." />
            ) : !termsQuery.data?.length ? (
              <p className="text-sm text-muted-foreground">
                {SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR}
              </p>
            ) : (
              <Select
                value={termId ?? undefined}
                onValueChange={(v) => {
                  requestWithUnsavedGuard({ kind: "set-term", termId: v });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفصل" />
                </SelectTrigger>
                <SelectContent>
                  {termsQuery.data.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.is_active ? " (فعّال)" : ""}
                      {t.academic_year ? ` · ${t.academic_year}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>نسخة الجدول</Label>
            {!canLoadVersions ? (
              <p className="text-sm text-muted-foreground">اختر فصلًا دراسيًا أولًا.</p>
            ) : versionsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : versionsQuery.isError ? (
              <ErrorInline message="تعذّر تحميل نسخ الجدول." />
            ) : !versionsQuery.data?.length ? (
              <p className="text-sm text-muted-foreground">
                {SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR}
              </p>
            ) : (
              <Select
                value={versionId ?? undefined}
                onValueChange={(v) => {
                  requestWithUnsavedGuard({ kind: "set-version", versionId: v });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر النسخة" />
                </SelectTrigger>
                <SelectContent>
                  {versionsQuery.data.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} — {STATUS_LABEL_AR[v.status as SVStatus] ?? v.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>النظام الدراسي</Label>
            <Select
              value={studySystem}
              onValueChange={(v) => {
                requestWithUnsavedGuard({
                  kind: "set-study-system",
                  studySystem: v as WorkspaceStudySystem,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">{STUDY_SYSTEM_LABELS.regular}</SelectItem>
                <SelectItem value="parallel">{STUDY_SYSTEM_LABELS.parallel}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Version cards */}
      {canLoadVersions && versionsQuery.data && versionsQuery.data.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {versionsQuery.data.map((v) => {
            const isSelected = v.id === versionId;
            const isPublished = v.status === "published";
            const sessionCount = isSelected && sessionsQuery.isSuccess ? allSessions.length : null;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  requestWithUnsavedGuard({ kind: "set-version", versionId: v.id });
                }}
                className={cn(
                  "text-right rounded-md border p-3 transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-muted/40",
                  isPublished && "border-emerald-500/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm">{v.name}</span>
                  <Badge variant={STATUS_BADGE_VARIANT[v.status as SVStatus] ?? "secondary"}>
                    {STATUS_LABEL_AR[v.status as SVStatus] ?? v.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  آخر تحديث: {formatUpdatedAt(v.updated_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  الجلسات:{" "}
                  {sessionCount == null
                    ? isSelected && sessionsQuery.isLoading
                      ? "…"
                      : "—"
                    : sessionCount}
                  {isPublished ? " · منشورة" : " · مسودة/عمل"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats */}
      {canLoadSessions && sessionsQuery.isSuccess && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard label="إجمالي الجلسات" value={stats.totalSessions} />
          <StatCard label="نظرية / محاضرة" value={stats.lectureCount} />
          <StatCard label="عملية" value={stats.labCount} />
          <StatCard label="المدرسون" value={stats.instructorCount} />
          <StatCard label="القاعات والمعامل" value={stats.roomCount} />
        </div>
      )}

      {/* Filters */}
      {canLoadSessions && sessionsQuery.isSuccess && allSessions.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">مرشحات العرض</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5 ms-1" />
              إعادة تعيين المرشحات
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <FilterSelect
              label="المدرس"
              value={filters.instructor}
              onChange={(v) => setFilter("instructor", v)}
              options={filterOptions.instructors}
            />
            <FilterSelect
              label="الشعبة"
              value={filters.section}
              onChange={(v) => setFilter("section", v)}
              options={filterOptions.sections}
            />
            <FilterSelect
              label="القاعة"
              value={filters.room}
              onChange={(v) => setFilter("room", v)}
              options={filterOptions.rooms}
            />
            <FilterSelect
              label="البرنامج"
              value={filters.program}
              onChange={(v) => setFilter("program", v)}
              options={filterOptions.programs}
            />
            <FilterSelect
              label="المستوى"
              value={filters.level}
              onChange={(v) => setFilter("level", v)}
              options={filterOptions.levels}
            />
            <FilterSelect
              label="نوع الجلسة"
              value={filters.sessionType}
              onChange={(v) => setFilter("sessionType", v)}
              options={filterOptions.sessionTypes}
            />
          </CardContent>
        </Card>
      )}

      {/* Grid / states */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            الشبكة الأسبوعية
            {selectedVersion ? (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                — {selectedVersion.name}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!canLoadSessions ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {!termId
                ? SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR
                : !versionId
                  ? SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR
                  : "اختر نسخة جدول لعرض الجلسات."}
            </p>
          ) : sessionsQuery.isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : sessionsQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">فشل تحميل جلسات النسخة المختارة.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => sessionsQuery.refetch()}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : allSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR}
            </p>
          ) : filteredSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR}
            </p>
          ) : (
            <TimetableGrid
              sessions={gridSessions}
              workingDays={workingDays}
              startHour={startHour}
              endHour={endHour}
              onSessionClick={onSessionClick}
              draggable={false}
            />
          )}
        </CardContent>
      </Card>

      <SessionDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        session={selectedSession}
      />

      <SessionEditSheet
        open={editSheetOpen && editModeActive && mayEnterEdit}
        onOpenChange={(open) => {
          if (!open) setEditSheetOpen(false);
        }}
        session={originalSelectedSession}
        rooms={rooms}
        workingDays={workingDays}
        versionName={selectedVersion?.name ?? null}
        pending={pending}
        onApplyLocal={onApplyLocal}
        onCancelChange={onCancelSessionChange}
      />

      <UnsavedLocalChangesDialog
        open={unsavedOpen}
        onOpenChange={setUnsavedOpen}
        title="تغييرات محلية غير محفوظة"
        description="توجد تغييرات محلية غير محفوظة. الحفظ غير متاح في هذه المرحلة. يمكنك المتابعة في التعديل أو تجاهل التغييرات."
        stayLabel="متابعة التعديل"
        discardLabel={
          pendingAction?.kind === "exit-edit"
            ? "تجاهل التغييرات والخروج"
            : "تجاهل التغييرات والمتابعة"
        }
        onStay={() => {
          setUnsavedOpen(false);
          setPendingAction(null);
        }}
        onDiscard={() => {
          const action = pendingAction;
          setUnsavedOpen(false);
          setPendingAction(null);
          setPending(null);
          if (action) runPendingAction(action);
          else discardPendingKeepEdit();
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
}) {
  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground pt-2">غير متاح في البيانات الحالية</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">الكل</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      </CardContent>
    </Card>
  );
}

function ErrorInline({ message }: { message: string }) {
  return (
    <p className="text-sm text-destructive flex items-center gap-1">
      <AlertCircle className="h-3.5 w-3.5" />
      {message}
    </p>
  );
}
