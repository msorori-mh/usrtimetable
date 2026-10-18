import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { type DropPayload } from "@/components/timetable/timetable-grid";
import {
  isScheduleVersionWriteLocked,
  resolveTimetableGridHours,
  shouldLoadWorkspaceCollegeScoped,
  shouldLoadWorkspaceSessions,
  shouldLoadWorkspaceVersions,
  type ScheduleVersionStatus,
} from "@/lib/schedule-builder/access";
import { canEnterEditMode, canOpenSessionForLocalEdit, editModeBlockedReason } from "@/lib/schedule-builder/edit-access";
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
  fetchWorkspaceExternalBusySlots,
  fetchWorkspaceInstructorPlanningContext,
  fetchWorkspaceRooms,
  fetchWorkspaceInstructors,
  fetchWorkspaceSchedulingSettings,
  fetchWorkspaceSessions,
  fetchWorkspaceTerms,
  fetchWorkspaceTimeTemplates,
  fetchWorkspaceVersions,
  type WorkspaceStudySystem,
} from "@/lib/schedule-builder/queries";
import {
  buildExternalBusyGridSessions,
  buildInstructorAvailabilityOverlay,
  instructorSlotBlockReason,
  summarizeInstructorPlanningContext,
} from "@/lib/schedule-builder/instructor-perspective";
import {
  EMPTY_WORKSPACE_FILTERS,
  buildFilterOptions,
  computeWorkspaceStats,
  filterWorkspaceSessions,
  mapWorkspaceSessions,
  type WorkspaceFilters,
  type WorkspaceSessionView,
} from "@/lib/schedule-builder/workspace";
import { formatDateTime } from "@/lib/format";

/**
 * State, reads and edit/save handlers of the schedule builder workspace. Split from
 * routes/_authenticated/schedule-builder.tsx (L-14); the page keeps the JSX.
 */
export const DEFAULT_WORKING_DAYS = [6, 0, 1, 2, 3, 4];
export type BuilderPerspective = "students" | "instructors";

export type PendingAction =
  | { kind: "exit-edit" }
  | { kind: "set-term"; termId: string }
  | { kind: "set-version"; versionId: string }
  | { kind: "set-study-system"; studySystem: WorkspaceStudySystem }
  | { kind: "set-perspective"; perspective: BuilderPerspective }
  | { kind: "set-instructor"; instructorId: string };

export function sessionDurationHours(session: Pick<WorkspaceSessionView, "start_time" | "end_time">) {
  const minutes = (value: string) => {
    const [hours, mins] = value.slice(0, 5).split(":").map(Number);
    return hours * 60 + mins;
  };
  return Math.max(0, (minutes(session.end_time) - minutes(session.start_time)) / 60);
}

export function formatUpdatedAt(iso: string): string {
  return formatDateTime(iso);
}

export function useScheduleBuilderWorkspace() {
  const queryClient = useQueryClient();
  const { active } = useActiveCollege();
  const canManageRole = useCanManageActiveCollege();
  const collegeId = active?.id ?? null;
  const canLoadCollege = shouldLoadWorkspaceCollegeScoped(!!collegeId);

  const [termId, setTermId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [studySystem, setStudySystem] = useState<WorkspaceStudySystem>("regular");
  const [perspective, setPerspective] = useState<BuilderPerspective>("students");
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
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
    setPerspective("students");
    setSelectedInstructorId("");
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

  const instructorsQuery = useQuery({
    queryKey: ["schedule-builder", "instructors", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceInstructors(collegeId!),
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

  const selectedInstructor = useMemo(
    () =>
      instructorsQuery.data?.find((instructor) => instructor.id === selectedInstructorId) ?? null,
    [instructorsQuery.data, selectedInstructorId],
  );

  const selectedInstructorRecordIds = useMemo(() => {
    if (!selectedInstructor) return [];
    return [...new Set([selectedInstructor.id, ...(selectedInstructor.record_ids ?? [])])];
  }, [selectedInstructor]);

  const instructorPlanningQuery = useQuery({
    queryKey: [
      "schedule-builder",
      "instructor-planning-context",
      collegeId,
      selectedInstructor?.identity_id ?? null,
    ],
    enabled:
      perspective === "instructors" &&
      !!collegeId &&
      !!selectedInstructor &&
      selectedInstructorRecordIds.length > 0,
    queryFn: () =>
      fetchWorkspaceInstructorPlanningContext({
        collegeId: collegeId!,
        instructorIds: selectedInstructorRecordIds,
      }),
  });

  const externalBusyQuery = useQuery({
    queryKey: [
      "schedule-builder",
      "instructor-external-busy",
      collegeId,
      versionId,
      selectedInstructor?.identity_id ?? null,
    ],
    enabled:
      perspective === "instructors" &&
      !!collegeId &&
      !!versionId &&
      !!selectedInstructor &&
      selectedInstructorRecordIds.length > 0,
    queryFn: () =>
      fetchWorkspaceExternalBusySlots({
        collegeId: collegeId!,
        versionId: versionId!,
        instructorIds: selectedInstructorRecordIds,
      }),
  });

  const instructorAvailabilityOverlay = useMemo(
    () =>
      buildInstructorAvailabilityOverlay({
        enforced: !!settingsQuery.data?.enforce_instructor_availability,
        windows: instructorPlanningQuery.data?.availability ?? [],
      }),
    [
      instructorPlanningQuery.data?.availability,
      settingsQuery.data?.enforce_instructor_availability,
    ],
  );

  const instructorPlanningSummary = useMemo(
    () =>
      summarizeInstructorPlanningContext(
        instructorPlanningQuery.data,
        settingsQuery.data?.max_daily_hours_per_instructor,
      ),
    [instructorPlanningQuery.data, settingsQuery.data?.max_daily_hours_per_instructor],
  );

  const externalBusySlots = useMemo(() => externalBusyQuery.data ?? [], [externalBusyQuery.data]);

  const externalBusyGridSessions = useMemo(
    () => buildExternalBusyGridSessions(externalBusySlots),
    [externalBusySlots],
  );

  const instructorCandidates = useMemo(
    () =>
      (instructorsQuery.data ?? []).map((instructor) => ({
        instructor_id: instructor.id,
        full_name: instructor.full_name,
        employee_number: instructor.university_number,
      })),
    [instructorsQuery.data],
  );

  const perspectiveSessions = useMemo(() => {
    if (perspective === "students") return displaySessions;
    if (!selectedInstructorRecordIds.length) return [];
    const recordIds = new Set(selectedInstructorRecordIds);
    return displaySessions.filter(
      (session) => !!session.instructor_id && recordIds.has(session.instructor_id),
    );
  }, [displaySessions, perspective, selectedInstructorRecordIds]);

  const filterOptions = useMemo(
    () => buildFilterOptions(perspectiveSessions, filters.program),
    [perspectiveSessions, filters.program],
  );

  const filteredSessions = useMemo(
    () => filterWorkspaceSessions(perspectiveSessions, filters),
    [perspectiveSessions, filters],
  );

  const gridSessions = useMemo(() => {
    const local = toGridSessionsWithPending(
      filteredSessions,
      pending,
      editModeActive ? selectedSessionId : null,
    );
    return perspective === "instructors" ? [...local, ...externalBusyGridSessions] : local;
  }, [
    filteredSessions,
    pending,
    editModeActive,
    selectedSessionId,
    perspective,
    externalBusyGridSessions,
  ]);

  const stats = useMemo(() => computeWorkspaceStats(allSessions), [allSessions]);
  const instructorHours = useMemo(
    () => perspectiveSessions.reduce((total, session) => total + sessionDurationHours(session), 0),
    [perspectiveSessions],
  );
  const instructorAttendanceDays = useMemo(
    () => new Set(perspectiveSessions.map((session) => session.day_of_week)).size,
    [perspectiveSessions],
  );

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
      case "set-perspective":
        setPerspective(action.perspective);
        setFilters(EMPTY_WORKSPACE_FILTERS);
        clearLocalEditState();
        break;
      case "set-instructor":
        setSelectedInstructorId(action.instructorId);
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
    const currentVersion = versionsQuery.data?.find((v) => v.id === versionId) ?? versionId;
    if (isProtectedDemoVersion(currentVersion)) {
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

    if (perspective === "instructors" && selectedInstructor) {
      const instructorReason = instructorSlotBlockReason({
        dayOfWeek: safety.proposed.day_of_week,
        startTime: safety.proposed.start_time,
        endTime: safety.proposed.end_time,
        availabilityEnforced: !!settingsQuery.data?.enforce_instructor_availability,
        availability: instructorPlanningQuery.data?.availability ?? [],
        externalBusy: externalBusySlots,
      });
      if (instructorReason) {
        toast.error(instructorReason);
        return;
      }
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
        `سحب → يوم ${params.day} ${params.startTime} (${session.course_name ?? "محاضرة"})`,
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
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "program" ? { level: "all" } : {}),
    }));
  };

  return {
    queryClient,
    active,
    canManageRole,
    collegeId,
    canLoadCollege,
    termId,
    setTermId,
    versionId,
    setVersionId,
    studySystem,
    setStudySystem,
    perspective,
    setPerspective,
    selectedInstructorId,
    setSelectedInstructorId,
    filters,
    setFilters,
    selectedSessionId,
    setSelectedSessionId,
    detailsOpen,
    setDetailsOpen,
    editSheetOpen,
    setEditSheetOpen,
    editModeActive,
    setEditModeActive,
    pending,
    setPending,
    undoStack,
    setUndoStack,
    editLog,
    setEditLog,
    validation,
    setValidation,
    validateLoading,
    setValidateLoading,
    saveLoading,
    setSaveLoading,
    saveMessage,
    setSaveMessage,
    unsavedOpen,
    setUnsavedOpen,
    pendingAction,
    setPendingAction,
    enrollmentOverlay,
    setEnrollmentOverlay,
    clearLocalEditState,
    discardPendingKeepEdit,
    termsQuery,
    canLoadVersions,
    versionsQuery,
    canLoadSessions,
    sessionsQuery,
    roomsQuery,
    instructorsQuery,
    settingsQuery,
    templatesQuery,
    workingDays,
    startHour,
    endHour,
    allSessions,
    rooms,
    displaySessions,
    selectedInstructor,
    selectedInstructorRecordIds,
    instructorPlanningQuery,
    externalBusyQuery,
    instructorAvailabilityOverlay,
    instructorPlanningSummary,
    externalBusySlots,
    externalBusyGridSessions,
    instructorCandidates,
    perspectiveSessions,
    filterOptions,
    filteredSessions,
    gridSessions,
    stats,
    instructorHours,
    instructorAttendanceDays,
    selectedSession,
    originalSelectedSession,
    selectedVersion,
    versionStatus,
    versionWriteLocked,
    mayEnterEdit,
    editBlockedReason,
    requestWithUnsavedGuard,
    runPendingAction,
    onSessionClick,
    toggleEditMode,
    onApplyLocal,
    onGridDrop,
    onUndoLocal,
    onCancelSessionChange,
    onCancelAllChanges,
    onValidateConflicts,
    onSaveChange,
    resetFilters,
    setFilter,
  };
}
