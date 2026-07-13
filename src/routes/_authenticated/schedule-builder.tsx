/**
 * Schedule Builder — read-only workspace.
 * Loads real schedule data scoped to the active college.
 * No mutations, scheduler, publish, or drag-and-drop.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveCollege } from "@/hooks/use-colleges";
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
import { TimetableGrid } from "@/components/timetable/timetable-grid";
import { SessionDetailsSheet } from "@/components/schedule-builder/session-details-sheet";
import {
  SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_COLLEGE_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR,
  resolveTimetableGridHours,
  shouldLoadWorkspaceCollegeScoped,
  shouldLoadWorkspaceSessions,
  shouldLoadWorkspaceVersions,
} from "@/lib/schedule-builder/access";
import {
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
  toGridSessions,
  type WorkspaceFilters,
  type WorkspaceSessionView,
} from "@/lib/schedule-builder/workspace";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LABEL_AR,
  type SVStatus,
} from "@/lib/schedule-versions/lifecycle";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { AlertCircle, CalendarRange, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedule-builder")({
  head: () => ({ meta: [{ title: "بناء الجدول" }] }),
  component: ScheduleBuilderWorkspacePage,
});

const DEFAULT_WORKING_DAYS = [6, 0, 1, 2, 3, 4];

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
  const collegeId = active?.id ?? null;
  const canLoadCollege = shouldLoadWorkspaceCollegeScoped(!!collegeId);

  const [termId, setTermId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [studySystem, setStudySystem] = useState<WorkspaceStudySystem>("regular");
  const [filters, setFilters] = useState<WorkspaceFilters>(EMPTY_WORKSPACE_FILTERS);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Reset local selection when college changes (page-local only — no DB write).
  useEffect(() => {
    setTermId(null);
    setVersionId(null);
    setFilters(EMPTY_WORKSPACE_FILTERS);
    setSelectedSessionId(null);
    setDetailsOpen(false);
  }, [collegeId]);

  const termsQuery = useQuery({
    queryKey: ["schedule-builder", "terms", collegeId],
    enabled: canLoadCollege,
    queryFn: () => fetchWorkspaceTerms(collegeId!),
  });

  // Prefer active term once terms load.
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
    queryFn: () =>
      fetchWorkspaceVersions({ collegeId: collegeId!, termId: termId! }),
  });

  // Auto-select newest version when term/versions change; clear if list empty.
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

  const filterOptions = useMemo(() => buildFilterOptions(allSessions), [allSessions]);

  const filteredSessions = useMemo(
    () => filterWorkspaceSessions(allSessions, filters),
    [allSessions, filters],
  );

  const gridSessions = useMemo(() => toGridSessions(filteredSessions), [filteredSessions]);
  const stats = useMemo(() => computeWorkspaceStats(allSessions), [allSessions]);

  const selectedSession: WorkspaceSessionView | null = useMemo(() => {
    if (!selectedSessionId) return null;
    return allSessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [allSessions, selectedSessionId]);

  const selectedVersion = versionsQuery.data?.find((v) => v.id === versionId) ?? null;

  const onSessionClick = (id: string) => {
    setSelectedSessionId(id);
    setDetailsOpen(true);
  };

  const resetFilters = () => setFilters(EMPTY_WORKSPACE_FILTERS);

  const setFilter = <K extends keyof WorkspaceFilters>(key: K, value: WorkspaceFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // --- Guard: no college ---
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
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">بناء الجدول</h1>
        <p className="text-sm text-muted-foreground">
          مساحة عمل قرائية لعرض بيانات الجدول الحالية دون كتابة أو توليد أو إصدار.
        </p>
      </header>

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
              <p className="text-sm text-muted-foreground">{SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR}</p>
            ) : (
              <Select
                value={termId ?? undefined}
                onValueChange={(v) => {
                  setTermId(v);
                  setVersionId(null);
                  setFilters(EMPTY_WORKSPACE_FILTERS);
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
              <p className="text-sm text-muted-foreground">{SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR}</p>
            ) : (
              <Select
                value={versionId ?? undefined}
                onValueChange={(v) => {
                  setVersionId(v);
                  setFilters(EMPTY_WORKSPACE_FILTERS);
                  setSelectedSessionId(null);
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
                setStudySystem(v as WorkspaceStudySystem);
                setFilters(EMPTY_WORKSPACE_FILTERS);
                setSelectedSessionId(null);
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
            const sessionCount =
              isSelected && sessionsQuery.isSuccess ? allSessions.length : null;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setVersionId(v.id);
                  setFilters(EMPTY_WORKSPACE_FILTERS);
                  setSelectedSessionId(null);
                }}
                className={cn(
                  "text-right rounded-md border p-3 transition-colors",
                  isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/40",
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
              <Button type="button" variant="outline" size="sm" onClick={() => sessionsQuery.refetch()}>
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

function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: string;
}) {
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
