import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TimetableGrid } from "@/components/timetable/timetable-grid";
import { SessionDetailsSheet } from "@/components/schedule-builder/session-details-sheet";
import { SessionEditSheet } from "@/components/schedule-builder/session-edit-sheet";
import { UnsavedLocalChangesDialog } from "@/components/schedule-builder/unsaved-local-changes-dialog";
import { V2WorkItemsPanel } from "@/components/schedule-builder/v2-work-items-panel";
import { InstructorCombobox } from "@/components/teaching-assignments/instructor-combobox";
import {
  SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_COLLEGE_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR,
} from "@/lib/schedule-builder/access";
import {
  SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR,
  SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR,
  SCHEDULE_BUILDER_UNSAVED_BADGE_AR,
  SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR,
} from "@/lib/schedule-builder/edit-access";
import {
  hasPendingChanges,
  snapshotOriginalFromSession,
} from "@/lib/schedule-builder/pending-change";
import {
  buildEvaluateDropTargetInput,
  evaluateDropTarget,
} from "@/lib/schedule-builder/drag-drop-safety";
import {
  formatInstructorWindow,
  instructorSlotBlockReason,
} from "@/lib/schedule-builder/instructor-perspective";
import { INSTRUCTOR_REQUEST_KIND_LABEL_AR } from "@/lib/availability/policy-api";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LABEL_AR,
  type SVStatus,
} from "@/lib/schedule-versions/lifecycle";
import {
  AlertCircle,
  CalendarClock,
  CalendarRange,
  ChevronDown,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/lib/format";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import {
  useScheduleBuilderWorkspace,
  formatUpdatedAt,
} from "@/hooks/use-schedule-builder-workspace";
import {
  StatCard,
  FilterSelect,
  EmptyState,
  ErrorInline,
} from "@/components/schedule-builder/builder-ui";
import { BuilderContextBar } from "@/components/schedule-builder/builder-context-bar";

export const Route = createFileRoute("/_authenticated/schedule-builder")({
  head: () => ({ meta: [{ title: "بناء الجدول" }] }),
  component: ScheduleBuilderWorkspacePage,
});

function ScheduleBuilderWorkspacePage() {
  const ws = useScheduleBuilderWorkspace();
  const {
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
  } = ws;

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

      {(roomsQuery.error ?? settingsQuery.error ?? templatesQuery.error) && (
        <QueryErrorNotice
          title="تعذّر تحميل القاعات أو إعدادات الجدولة أو قوالب الأوقات؛ قد تكون الشبكة والقوائم ناقصة."
          error={roomsQuery.error ?? settingsQuery.error ?? templatesQuery.error}
          onRetry={() => {
            void roomsQuery.refetch();
            void settingsQuery.refetch();
            void templatesQuery.refetch();
          }}
        />
      )}
      {/* Context bar */}
      <BuilderContextBar ws={ws} />

      <Card className="min-w-0 border-primary/20">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-base">منظور بناء الجدول</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                قواعد التعارض والإتاحة والعبء نفسها مطبقة في المنظورين.
              </p>
            </div>
            <div className="grid grid-cols-2 rounded-lg border bg-muted/30 p-1">
              <Button
                type="button"
                size="sm"
                variant={perspective === "students" ? "default" : "ghost"}
                onClick={() => {
                  if (perspective !== "students") {
                    requestWithUnsavedGuard({ kind: "set-perspective", perspective: "students" });
                  }
                }}
              >
                جدول الطلاب
              </Button>
              <Button
                type="button"
                size="sm"
                variant={perspective === "instructors" ? "default" : "ghost"}
                onClick={() => {
                  if (perspective !== "instructors") {
                    requestWithUnsavedGuard({
                      kind: "set-perspective",
                      perspective: "instructors",
                    });
                  }
                }}
              >
                <Users className="ms-1 h-4 w-4" aria-hidden />
                جدول المحاضر
              </Button>
            </div>
          </div>

          {perspective === "instructors" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-2">
                  <Label>المحاضر</Label>
                  {instructorsQuery.isLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : instructorsQuery.isError ? (
                    <ErrorInline message="تعذر تحميل دليل المحاضرين." />
                  ) : (
                    <InstructorCombobox
                      candidates={instructorCandidates}
                      value={selectedInstructorId}
                      onChange={(instructorId) => {
                        if (instructorId !== selectedInstructorId) {
                          requestWithUnsavedGuard({ kind: "set-instructor", instructorId });
                        }
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">{perspectiveSessions.length} محاضرة في النسخة</Badge>
                  <Badge variant="outline">{formatDecimal(instructorHours)} ساعة أسبوعيًا</Badge>
                </div>
              </div>

              {selectedInstructor ? (
                <div
                  data-testid="instructor-builder-planning-context"
                  className="rounded-lg border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{selectedInstructor.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedInstructor.university_number}
                        {selectedInstructor.home_college_name
                          ? ` · الكلية الأصلية: ${selectedInstructor.home_college_name}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        النصاب:{" "}
                        {selectedInstructor.authoritative_quota ??
                          selectedInstructor.recorded_quota ??
                          "—"}
                      </Badge>
                      <Badge variant="outline">
                        الحد اليومي: {instructorPlanningSummary.dailyLimit ?? "—"} ساعة
                      </Badge>
                      <Badge variant="outline">
                        الحضور: {instructorAttendanceDays}
                        {instructorPlanningSummary.maxAttendanceDays != null
                          ? ` / ${instructorPlanningSummary.maxAttendanceDays}`
                          : ""}{" "}
                        يوم
                      </Badge>
                      <Badge
                        variant={
                          settingsQuery.data?.enforce_instructor_availability
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {settingsQuery.data?.enforce_instructor_availability
                          ? `الإتاحة ملزمة · ${instructorPlanningSummary.hardWindows}`
                          : "الإتاحة إرشادية"}
                      </Badge>
                      <Badge variant={externalBusySlots.length ? "secondary" : "outline"}>
                        {externalBusySlots.length} ارتباط عبر الكليات
                      </Badge>
                      {instructorPlanningSummary.pendingRequests ? (
                        <Badge variant="destructive">
                          {instructorPlanningSummary.pendingRequests} طلب قيد المراجعة
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {instructorPlanningQuery.isError || externalBusyQuery.isError ? (
                    <p className="mt-3 text-xs text-destructive" role="alert">
                      تعذر تحميل بعض سياق المحاضر. يظل فحص الخادم إلزاميًا قبل أي حفظ.
                    </p>
                  ) : null}

                  <details className="mt-3 border-t pt-3 text-xs">
                    <summary className="cursor-pointer font-medium">
                      الإتاحة والطلبات والارتباطات
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="font-medium">نوافذ الإتاحة</p>
                        {instructorPlanningQuery.data?.availability.length ? (
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            {instructorPlanningQuery.data.availability.map((window) => (
                              <li key={window.id}>
                                {formatInstructorWindow(window)} ·{" "}
                                {window.is_preference ? "تفضيل" : "ملزم"}
                                {window.availability_type === "unavailable" ? " · غير متاح" : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-muted-foreground">لا توجد نوافذ مسجلة.</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">طلبات المحاضر</p>
                        {instructorPlanningQuery.data?.requests.length ? (
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            {instructorPlanningQuery.data.requests.slice(0, 8).map((request) => (
                              <li key={request.id}>
                                {INSTRUCTOR_REQUEST_KIND_LABEL_AR[request.request_kind]} ·{" "}
                                {request.status === "submitted"
                                  ? "قيد المراجعة"
                                  : request.status === "approved"
                                    ? "معتمد"
                                    : request.status === "rejected"
                                      ? "مرفوض"
                                      : "ملغى"}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-muted-foreground">لا توجد طلبات مسجلة.</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">الانشغال خارج الكلية</p>
                        {externalBusySlots.length ? (
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            {externalBusySlots.map((slot, index) => (
                              <li
                                key={`${slot.day_of_week}-${slot.start_time}-${slot.end_time}-${index}`}
                              >
                                {formatInstructorWindow(slot)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-muted-foreground">
                            لا توجد فترات تعارض خارجية ظاهرة.
                          </p>
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          {perspective === "students" ? (
            <>
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
            </>
          ) : (
            <div className="space-y-1 sm:col-span-2">
              <p className="font-medium">{selectedInstructor?.full_name ?? "اختر محاضرًا"}</p>
              <p className="text-xs text-muted-foreground">
                {selectedInstructor
                  ? `${selectedInstructor.university_number} · يعرض جلساته في النسخة الحالية وانشغاله الموحّد عبر الكليات.`
                  : "بعد اختيار المحاضر ستظهر محاضراته والتكليفات غير المجدولة الخاصة به فقط."}
              </p>
            </div>
          )}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              عرض {filteredSessions.length} من {perspectiveSessions.length} جلسة.
            </p>
            <p>في وضع التعديل، اضغط على الجلسة لتعديلها ثم افحص التعارضات واحفظ.</p>
            <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
              إظهار جميع الجلسات
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grid / states */}
      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {perspective === "instructors"
              ? selectedInstructor
                ? `الجدول الأسبوعي للمحاضر: ${selectedInstructor.full_name}`
                : "الشبكة الأسبوعية للمحاضر"
              : "الشبكة الأسبوعية للطلاب"}
            {selectedVersion ? (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                — {selectedVersion.name}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          {perspective === "instructors" && !selectedInstructor ? (
            <div className="py-10 text-center">
              <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">اختر محاضرًا لبدء بناء جدوله يدويًا.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                ستظهر جلساته الحالية والتكليفات المتبقية مع فحص التعارض والإتاحة والعبء.
              </p>
            </div>
          ) : !canLoadSessions ? (
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
          ) : allSessions.length === 0 && perspective === "students" ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR}
            </p>
          ) : filteredSessions.length === 0 && externalBusyGridSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {perspective === "instructors"
                ? "لا توجد جلسات مجدولة لهذا المحاضر في النسخة المختارة. استخدم قائمة الجلسات المتبقية لإضافتها."
                : SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR}
            </p>
          ) : (
            <>
              <TimetableGrid
                sessions={gridSessions}
                workingDays={workingDays}
                startHour={startHour}
                endHour={endHour}
                availability={
                  perspective === "instructors"
                    ? instructorAvailabilityOverlay.available
                    : undefined
                }
                unavailability={
                  perspective === "instructors"
                    ? instructorAvailabilityOverlay.unavailable
                    : undefined
                }
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
                        if (safety.kind === "forbidden" || !safety.proposed) {
                          return "red";
                        }
                        if (perspective === "instructors" && selectedInstructor) {
                          const instructorReason = instructorSlotBlockReason({
                            dayOfWeek: safety.proposed.day_of_week,
                            startTime: safety.proposed.start_time,
                            endTime: safety.proposed.end_time,
                            availabilityEnforced:
                              !!settingsQuery.data?.enforce_instructor_availability,
                            availability: instructorPlanningQuery.data?.availability ?? [],
                            externalBusy: externalBusySlots,
                          });
                          if (instructorReason) return "red";
                        }
                        return safety.tone;
                      }
                    : undefined
                }
              />
              {perspective === "instructors" ? (
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm border border-primary/50 bg-primary/20" />
                    جلسة في النسخة الحالية
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm border border-slate-500/60 bg-slate-500/25" />
                    مشغول في كلية أخرى
                  </span>
                  {settingsQuery.data?.enforce_instructor_availability ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                      المناطق المظللة خارج الإتاحة الملزمة
                    </span>
                  ) : null}
                </div>
              ) : null}
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

      {canLoadSessions &&
      sessionsQuery.isSuccess &&
      versionId &&
      (perspective === "students" || selectedInstructor) ? (
        <V2WorkItemsPanel
          scheduleVersionId={versionId}
          studySystem={studySystem}
          rooms={rooms}
          canManage={canManageRole}
          instructorIds={perspective === "instructors" ? selectedInstructorRecordIds : undefined}
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
                        "text-start rounded-md border p-3 transition-colors",
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
                {perspective === "students" ? (
                  <FilterSelect
                    label="المدرس"
                    value={filters.instructor}
                    onChange={(v) => setFilter("instructor", v)}
                    options={filterOptions.instructors}
                  />
                ) : null}
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
