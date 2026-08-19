/**
 * Schedule Builder workspace — read model + local edit + drag-drop pending + conflict validate/save via RPC.
 * Drag-drop updates local pending only (no save RPC / no direct schedule_sessions updates).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { TimetableGrid, type DropPayload } from "@/components/timetable/timetable-grid";
import { SessionDetailsSheet } from "@/components/schedule-builder/session-details-sheet";
import { SessionEditSheet } from "@/components/schedule-builder/session-edit-sheet";
import { UnsavedLocalChangesDialog } from "@/components/schedule-builder/unsaved-local-changes-dialog";
import { V2WorkItemsPanel } from "@/components/schedule-builder/v2-work-items-panel";
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
  snapshotOriginalFromSession,
  toGridSessionsWithPending,
  validateLocalEditForm,
  type LocalEditFormValues,
  type PendingScheduleSessionChange,
} from "@/lib/schedule-builder/pending-change";
import {
  buildEvaluateDropTargetInput,
  evaluateDropTarget,
  isProtectedDemoVersion,
  popUndo,
  publishedVersionConfirmMessage,
  pushUndo,
} from "@/lib/schedule-builder/drag-drop-safety";
import {
  canSaveAfterValidation,
  moveOrRescheduleScheduleSession,
  validateScheduleSessionMove,
  type ValidateSessionMoveResult,
} from "@/lib/schedule-builder/session-move-rpc";
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
import {
  AlertCircle,
  CalendarRange,
  ChevronDown,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
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
  const queryClient = useQueryClient();
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
  const [undoStack, setUndoStack] = useState<PendingScheduleSessionChange[]>([]);
  const [editLog, setEditLog] = useState<string[]>([]);
  const [validation, setValidation] = useState<ValidateSessionMoveResult | null>(null);
  const [validateLoading, setValidateLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  /** Local enrollment trust overlay — independent of session pending; no query cache rewrite. */
  const [enrollmentOverlay, setEnrollmentOverlay] = useState<
    Record<
      string,
      {
        enrollmentCount: number;
        enrollmentCountStatus: WorkspaceSessionView["enrollment_count_status"];
        enrollmentCountUpdatedAt: string;
      }
    >
  >({});

  const clearLocalEditState = useCallback(() => {
    setPending(null);
    setValidation(null);
    setSaveMessage(null);
    setSelectedSessionId(null);
    setDetailsOpen(false);
    setEditSheetOpen(false);
  }, []);

  const discardPendingKeepEdit = useCallback(() => {
    setPending(null);
    setValidation(null);
    setSaveMessage(null);
    setEditSheetOpen(false);
  }, []);

  // Reset local selection when college changes (page-local only — no DB write).
  useEffect(() => {
    setTermId(null);
    setVersionId(null);
    setFilters(EMPTY_WORKSPACE_FILTERS);
    setEditModeActive(false);
    setEnrollmentOverlay({});
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
    queryKey: ["schedule-builder", "sessions", collegeId, termId, versionId, studySystem],
    enabled: canLoadSessions,
    queryFn: () =>
      fetchWorkspaceSessions({
        collegeId: collegeId!,
        termId: termId!,
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

  const allSessions = useMemo(() => {
    const mapped = mapWorkspaceSessions(sessionsQuery.data ?? []);
    if (!Object.keys(enrollmentOverlay).length) return mapped;
    return mapped.map((s) => {
      const off =
        !s.cohort_id && s.course_offering_id ? enrollmentOverlay[s.course_offering_id] : undefined;
      if (!off) return s;
      return {
        ...s,
        enrollment_count: off.enrollmentCount,
        enrollment_count_status: off.enrollmentCountStatus,
        enrollment_count_updated_at: off.enrollmentCountUpdatedAt,
      };
    });
  }, [sessionsQuery.data, enrollmentOverlay]);

  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data]);

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
    setValidation(null);
    setSaveMessage(null);
    return { ok: true as const };
  };

  /** HTML5 drop → local pending only (preserve duration + room; clear prior validation; no RPC). */
  const onGridDrop = (params: { day: number; startTime: string; payload: DropPayload }) => {
    if (!mayEnterEdit || !editModeActive) return;
    if (params.payload.kind !== "session") return;
    if (isProtectedDemoVersion(versionId)) {
      toast.error("نسخة العرض المحمية — التعديل الحي مرفوض في هذه المهمة.");
      return;
    }

    const session = allSessions.find((s) => s.id === params.payload.id) ?? null;
    if (
      !canOpenSessionForLocalEdit({
        editModeActive: true,
        canEnterEdit: mayEnterEdit,
        session,
      })
    ) {
      if (session?.is_locked) {
        toast.error("هذه الجلسة مقفلة ولا يمكن تحريكها محليًا.");
      }
      return;
    }
    if (!session) return;

    const sourceSlot =
      pending && pending.sessionId === session.id && hasPendingChanges(pending)
        ? pending.proposed
        : snapshotOriginalFromSession(session);

    const safety = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot,
        movingSession: session,
        day_of_week: params.day,
        start_time: params.startTime,
        others: allSessions,
        rooms,
      }),
    );
    if (safety.kind === "forbidden" || !safety.proposed) {
      toast.error(safety.reason_ar ?? "خانة ممنوعة قبل الإفلات.");
      return;
    }

    const confirmMsg = publishedVersionConfirmMessage(selectedVersion?.status ?? null);
    if (confirmMsg) {
      toast.message(confirmMsg);
    }

    const next = buildPendingChange({
      session,
      proposed: safety.proposed,
      changeReason: pending?.sessionId === session.id ? pending.changeReason : "",
    });
    if (pending && hasPendingChanges(pending)) {
      setUndoStack((stack) => pushUndo(stack, pending));
    }
    setPending(next);
    setEditLog((log) =>
      [
        ...log,
        `سحب → يوم ${params.day} ${params.startTime} (${session.course_code ?? session.id.slice(0, 8)})`,
      ].slice(-30),
    );
    setValidation(null);
    setSaveMessage(null);
    setSelectedSessionId(session.id);
    setDetailsOpen(false);
    setEditSheetOpen(true);
  };

  const onUndoLocal = () => {
    const { stack, item } = popUndo(undoStack);
    setUndoStack(stack);
    if (!item) {
      setPending(null);
      return;
    }
    setPending(item);
    setEditLog((log) => [...log, "تراجع محلي قبل الحفظ"].slice(-30));
    setValidation(null);
  };

  const onCancelSessionChange = () => {
    setPending(null);
    setValidation(null);
    setSaveMessage(null);
  };

  const onCancelAllChanges = () => {
    setPending(null);
    setUndoStack([]);
    setValidation(null);
    setSaveMessage(null);
    setEditSheetOpen(false);
  };

  const onValidateConflicts = async () => {
    if (!pending || !hasPendingChanges(pending) || !mayEnterEdit) return;
    setValidateLoading(true);
    setSaveMessage(null);
    try {
      const result = await validateScheduleSessionMove(pending);
      setValidation(result);
      if (result.stale) {
        toast.error(result.message_ar ?? "الجلسة أصبحت قديمة.");
      } else if (!result.valid) {
        toast.error(result.message_ar ?? "توجد تعارضات أو قيود تمنع الحفظ.");
      } else {
        toast.success("التحقق ناجح — لا توجد تعارضات مانعة.");
      }
    } catch {
      setValidation({
        valid: false,
        blocking_conflicts: [],
        warnings: [],
        approved_exceptions: [],
        stale: false,
        normalized_proposal: null,
        code: "RPC_ERROR",
        message_ar: "فشل الاتصال أثناء فحص التعارضات.",
      });
      toast.error("فشل الاتصال أثناء فحص التعارضات.");
    } finally {
      setValidateLoading(false);
    }
  };

  const onSaveChange = async () => {
    if (!pending || !hasPendingChanges(pending) || !mayEnterEdit) return;
    if (!canSaveAfterValidation(validation)) {
      toast.error("افحص التعارضات بنجاح قبل الحفظ.");
      return;
    }
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const result = await moveOrRescheduleScheduleSession(pending);
      if (result.ok) {
        setPending(null);
        setValidation(null);
        setSaveMessage("تم حفظ التغيير بنجاح.");
        toast.success("تم حفظ تغيير الجلسة.");
        await queryClient.invalidateQueries({ queryKey: ["schedule-builder"] });
        return;
      }
      if (result.blocking_conflicts.length || result.warnings.length) {
        setValidation({
          valid: false,
          blocking_conflicts: result.blocking_conflicts,
          warnings: result.warnings,
          approved_exceptions: result.approved_exceptions,
          stale: result.stale,
          normalized_proposal: null,
          code: result.code,
          message_ar: result.message_ar,
        });
      } else if (result.stale) {
        setValidation({
          valid: false,
          blocking_conflicts: [],
          warnings: [],
          approved_exceptions: [],
          stale: true,
          normalized_proposal: null,
          code: result.code ?? "STALE_SESSION",
          message_ar: result.message_ar,
        });
      }
      setSaveMessage(result.message_ar ?? "تعذّر الحفظ. بقي التغيير المحلي غير محفوظ.");
      toast.error(result.message_ar ?? "تعذّر حفظ التغيير.");
    } catch {
      setSaveMessage("فشل الاتصال أثناء الحفظ. بقي التغيير المحلي.");
      toast.error("فشل الاتصال أثناء الحفظ.");
    } finally {
      setSaveLoading(false);
    }
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
    <div
      className="flex w-full min-w-0 max-w-full flex-col gap-4 overflow-x-hidden p-4 md:p-6"
      dir="rtl"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">بناء الجدول</h1>
          <p className="text-sm text-muted-foreground">
            اختر النسخة، راجع الشبكة، ثم أضف أو عدّل الجلسات مع فحص التعارضات قبل الحفظ.
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
          انقر جلسة لفتح لوحة التعديل. طبّق محليًا ثم افحص التعارضات قبل الحفظ.{" "}
          {SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR.replace(
            "ضمن هذه المرحلة",
            "إلا عبر زر الحفظ الآمن",
          )}
        </div>
      ) : null}

      {/* Context bar */}
      <Card className="min-w-0">
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

      {/* Grid / states */}
      <Card className="min-w-0">
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
        <CardContent className="min-w-0 overflow-hidden">
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
            <>
              <TimetableGrid
                sessions={gridSessions}
                workingDays={workingDays}
                startHour={startHour}
                endHour={endHour}
                onSessionClick={onSessionClick}
                draggable={editModeActive && mayEnterEdit}
                onDropAt={onGridDrop}
                getDropTone={
                  editModeActive && selectedSessionId
                    ? (day, startTime) => {
                        const session = allSessions.find((s) => s.id === selectedSessionId);
                        if (!session) return null;
                        const sourceSlot =
                          pending && pending.sessionId === session.id && hasPendingChanges(pending)
                            ? pending.proposed
                            : snapshotOriginalFromSession(session);
                        const safety = evaluateDropTarget(
                          buildEvaluateDropTargetInput({
                            sourceSlot,
                            movingSession: session,
                            day_of_week: day,
                            start_time: startTime,
                            others: allSessions,
                            rooms,
                          }),
                        );
                        return safety.tone;
                      }
                    : undefined
                }
              />
              {editModeActive && (
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onUndoLocal}
                    disabled={undoStack.length === 0 && !pending}
                  >
                    تراجع محلي
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    سجل الجلسة: {editLog.slice(-3).join(" · ") || "—"}
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {canLoadSessions && sessionsQuery.isSuccess && versionId ? (
        <V2WorkItemsPanel
          scheduleVersionId={versionId}
          studySystem={studySystem}
          rooms={rooms}
          canManage={canManageRole}
        />
      ) : null}

      <details
        data-testid="builder-advanced-view-options"
        className="group rounded-lg border bg-card text-card-foreground shadow-sm"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 font-medium">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
            خيارات العرض والتفاصيل
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {sessionsQuery.isSuccess ? `${stats.totalSessions} جلسة` : "إعدادات إضافية"}
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </summary>

        <div className="space-y-4 border-t p-4">
          {/* Version cards are a secondary shortcut; the primary selector stays above the grid. */}
          {canLoadVersions && versionsQuery.data && versionsQuery.data.length > 0 && (
            <section className="space-y-2" aria-labelledby="builder-version-shortcuts-title">
              <h2 id="builder-version-shortcuts-title" className="text-sm font-medium">
                اختصارات نسخ الجدول
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {versionsQuery.data.map((v) => {
                  const isSelected = v.id === versionId;
                  const isPublished = v.status === "published";
                  const sessionCount =
                    isSelected && sessionsQuery.isSuccess ? allSessions.length : null;
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
            </section>
          )}

          {canLoadSessions && sessionsQuery.isSuccess && (
            <section className="space-y-2" aria-labelledby="builder-stats-title">
              <h2 id="builder-stats-title" className="text-sm font-medium">
                ملخص النسخة الحالية
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <StatCard label="إجمالي الجلسات" value={stats.totalSessions} />
                <StatCard label="نظرية / محاضرة" value={stats.lectureCount} />
                <StatCard label="عملية" value={stats.labCount} />
                <StatCard label="المدرسون" value={stats.instructorCount} />
                <StatCard label="القاعات والمعامل" value={stats.roomCount} />
              </div>
            </section>
          )}

          {canLoadSessions && sessionsQuery.isSuccess && allSessions.length > 0 && (
            <section className="space-y-3" aria-labelledby="builder-filters-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="builder-filters-title" className="text-sm font-medium">
                  مرشحات العرض
                </h2>
                <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5 ms-1" />
                  إعادة تعيين المرشحات
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <FilterSelect
                  label="المدرس"
                  value={filters.instructor}
                  onChange={(v) => setFilter("instructor", v)}
                  options={filterOptions.instructors}
                />
                <FilterSelect
                  label="مجموعة المحاضرة أو المعمل"
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
              </div>
            </section>
          )}
        </div>
      </details>

      <SessionDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        session={selectedSession}
        collegeId={collegeId}
        rooms={rooms}
        canEditEnrollment={canManageRole}
        onEnrollmentSaved={(payload) => {
          // Overlay only — preserves session pending; does not rewrite query cache.
          setEnrollmentOverlay((prev) => ({
            ...prev,
            [payload.courseOfferingId]: {
              enrollmentCount: payload.enrollmentCount,
              enrollmentCountStatus: payload.enrollmentCountStatus,
              enrollmentCountUpdatedAt: payload.enrollmentCountUpdatedAt,
            },
          }));
          toast.success("تم حفظ عدد الطلاب وحالة الموثوقية.");
        }}
        onSplitApproved={(payload) => {
          // Independent of session pending save — subgroups only when RPC applied.
          toast.success(payload.statusAr);
        }}
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
        validation={validation}
        validateLoading={validateLoading}
        saveLoading={saveLoading}
        saveMessage={saveMessage}
        onApplyLocal={onApplyLocal}
        onCancelChange={onCancelSessionChange}
        onValidateConflicts={onValidateConflicts}
        onSaveChange={onSaveChange}
      />

      <UnsavedLocalChangesDialog
        open={unsavedOpen}
        onOpenChange={setUnsavedOpen}
        title="تغييرات محلية غير محفوظة"
        description="توجد تغييرات محلية غير محفوظة. يمكنك المتابعة في التعديل أو تجاهل التغييرات. الحفظ يتم فقط عبر زر حفظ التغيير بعد فحص التعارضات."
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
          setValidation(null);
          setSaveMessage(null);
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
