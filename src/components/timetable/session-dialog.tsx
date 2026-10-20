import { availabilityStatusLabelAr, canReceiveNewWork } from "@/lib/instructor-metadata";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { entityDisplayName, instructorDisplayName } from "@/lib/entity-display";
import { chunkIds, readAllRows } from "@/lib/supabase/read-all";
import { confirmAction } from "@/components/confirm-dialog";
import type { Conflict } from "@/lib/conflict-engine/validator";
import { createScheduleSessionFromAssignmentV2 } from "@/lib/schedule-builder/v2-assignment-service";
import {
  deleteScheduleSession,
  invalidateSessionReadModels,
  previewManualScheduleSession,
  saveManualScheduleSession,
  SessionWriteError,
  type ManualSessionForm,
} from "@/lib/schedule-versions/session-writes";
import { mapServerConflict } from "@/lib/conflict-engine/server-validation";
import { SearchableSelect } from "@/components/timetable/searchable-select";
import { AlertTriangle, Trash2, Lock, Unlock } from "lucide-react";

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

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  collegeId: string;
  scheduleVersionId: string;
  sessionId?: string | null;
  defaults?: Partial<FormState>;
  /** When true: view-only — no save, delete, or field mutations. */
  readOnly?: boolean;
}

interface FormState extends ManualSessionForm {
  source_type: "manual" | "auto_generated" | "cloned" | "capacity_subgroup_child";
}

const empty: FormState = {
  course_offering_id: "",
  teaching_assignment_id: null,
  instructor_id: "",
  room_id: null,
  section_id: null,
  section_group_id: null,
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  session_type: "lecture",
  expected_students: 0,
  is_locked: false,
  lock_reason: null,
  source_type: "manual",
};

/** Explicit columns only: the form never carries (or sends back) unrelated row data (M-19). */
const SESSION_COLUMNS =
  "id, updated_at, course_offering_id, teaching_assignment_id, instructor_id, room_id, section_id, section_group_id, study_system, day_of_week, start_time, end_time, session_type, expected_students, is_locked, lock_reason, source_type";

type SessionRow = FormState & { id: string; updated_at: string };
type InstructorOption = { id: string; full_name: string; availability_status: string | null };

function formFromRow(row: SessionRow): FormState {
  return {
    course_offering_id: row.course_offering_id,
    teaching_assignment_id: row.teaching_assignment_id,
    instructor_id: row.instructor_id,
    room_id: row.room_id,
    section_id: row.section_id,
    section_group_id: row.section_group_id,
    study_system: row.study_system,
    day_of_week: row.day_of_week,
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
    session_type: row.session_type,
    expected_students: row.expected_students ?? 0,
    is_locked: !!row.is_locked,
    lock_reason: row.lock_reason,
    source_type: row.source_type,
  };
}

export function SessionDialog({
  open,
  onOpenChange,
  collegeId,
  scheduleVersionId,
  sessionId,
  defaults,
  readOnly = false,
}: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({ ...empty, ...(defaults ?? {}) });
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [validating, setValidating] = useState(false);
  const canMutate = !readOnly;

  const versionQuery = useQuery({
    queryKey: ["session-dialog-version", scheduleVersionId],
    enabled: open && !!scheduleVersionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, college_id, academic_term_id, updated_at")
        .eq("id", scheduleVersionId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const termId = versionQuery.data?.academic_term_id ?? null;

  const sessionQuery = useQuery({
    queryKey: ["session-dialog-session", sessionId],
    enabled: open && !!sessionId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", sessionId!)
        .single();
      if (error) throw error;
      return data as unknown as SessionRow;
    },
  });
  const sessionRow = sessionQuery.data ?? null;

  // Reset on every open: a new session starts from the defaults, an existing one from its
  // stored row; stale conflicts of the previous session never carry over.
  useEffect(() => {
    if (!open) return;
    setConflicts([]);
    if (sessionId) {
      if (sessionRow && sessionRow.id === sessionId) setForm(formFromRow(sessionRow));
    } else {
      setForm({ ...empty, ...(defaults ?? {}) });
    }
  }, [open, sessionId, sessionRow, defaults]);

  // Option lists are scoped server-side to this college (and the version's term) and read
  // completely; any read error is surfaced (M-20).
  const offeringsQuery = useQuery({
    queryKey: ["session-dialog-offerings", collegeId, termId],
    enabled: open && !!collegeId && !!termId,
    queryFn: async () => {
      const offerings = await readAllRows<{
        id: string;
        course_id: string;
        expected_students: number | null;
      }>((from, to) =>
        supabase
          .from("course_offerings")
          .select("id, course_id, expected_students")
          .eq("college_id", collegeId)
          .eq("term_id", termId!)
          .order("id")
          .range(from, to),
      );
      const courseIds = [...new Set(offerings.map((o) => o.course_id).filter(Boolean))];
      const courses: Array<{ id: string; code: string | null; name: string | null }> = [];
      for (const ids of chunkIds(courseIds)) {
        const { data, error } = await supabase
          .from("courses")
          .select("id, code, name")
          .in("id", ids);
        if (error) throw error;
        courses.push(...(data ?? []));
      }
      const byId = new Map(courses.map((c) => [c.id, c]));
      return offerings.map((o) => ({ ...o, course: byId.get(o.course_id) ?? null }));
    },
  });
  const instructorsQuery = useQuery({
    queryKey: ["session-dialog-instructors", collegeId, form.instructor_id],
    enabled: open && !!collegeId,
    queryFn: async () => {
      const rows = await readAllRows<InstructorOption>((from, to) =>
        supabase
          .from("instructors")
          .select("id, full_name, availability_status")
          .eq("college_id", collegeId)
          .order("id")
          .range(from, to),
      );
      // A visiting (other-college) instructor of an existing session stays visible.
      if (form.instructor_id && !rows.some((r) => r.id === form.instructor_id)) {
        const { data, error } = await supabase
          .from("instructors")
          .select("id, full_name, availability_status")
          .eq("id", form.instructor_id)
          .maybeSingle();
        if (error) throw error;
        if (data) rows.push(data as InstructorOption);
      }
      return rows;
    },
  });
  const roomsQuery = useQuery({
    queryKey: ["session-dialog-rooms", collegeId],
    enabled: open && !!collegeId,
    queryFn: () =>
      readAllRows<{ id: string; code: string | null; name: string | null; capacity: number }>(
        (from, to) =>
          supabase
            .from("rooms")
            .select("id, code, name, capacity")
            .eq("college_id", collegeId)
            .eq("is_active", true)
            .order("id")
            .range(from, to),
      ),
  });
  const sectionsQuery = useQuery({
    queryKey: ["session-dialog-sections", collegeId, termId],
    enabled: open && !!collegeId && !!termId,
    queryFn: () =>
      readAllRows<{
        id: string;
        section_number: string;
        study_system: string | null;
        course_id: string | null;
      }>((from, to) =>
        supabase
          .from("sections")
          .select("id, section_number, study_system, course_id")
          .eq("college_id", collegeId)
          .eq("term_id", termId!)
          .order("id")
          .range(from, to),
      ),
  });
  const assignmentsQuery = useQuery({
    queryKey: ["session-dialog-assignments", collegeId, form.course_offering_id],
    enabled: open && !!collegeId && !!form.course_offering_id,
    queryFn: () =>
      readAllRows<{
        id: string;
        course_offering_id: string;
        instructor_id: string;
        is_active: boolean;
        delivery_group_id: string | null;
      }>((from, to) =>
        supabase
          .from("teaching_assignments")
          .select("id, course_offering_id, instructor_id, is_active, delivery_group_id")
          .eq("college_id", collegeId)
          .eq("course_offering_id", form.course_offering_id)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      ),
  });
  const optionsError =
    versionQuery.error ??
    sessionQuery.error ??
    offeringsQuery.error ??
    instructorsQuery.error ??
    roomsQuery.error ??
    sectionsQuery.error ??
    assignmentsQuery.error;

  const instructors = useMemo(() => instructorsQuery.data ?? [], [instructorsQuery.data]);
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const selectedOffering = offeringsQuery.data?.find((o) => o.id === form.course_offering_id);
  const sectionOptions = (sectionsQuery.data ?? []).filter(
    (s) => !selectedOffering || !s.course_id || s.course_id === selectedOffering.course_id,
  );

  const runValidate = async () => {
    if (!canMutate) return null;
    setValidating(true);
    try {
      const res = await previewManualScheduleSession({
        sessionId: sessionId ?? null,
        scheduleVersionId,
        form,
      });
      setConflicts([...res.blocking, ...res.warnings]);
      if (res.valid) toast.success("لا توجد تعارضات إلزامية");
      return res;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setValidating(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!canMutate) throw new Error("العرض للقراءة فقط — لا يمكن الحفظ");
      if (!form.course_offering_id || !form.instructor_id)
        throw new Error("المقرر والمحاضر مطلوبان");
      const assignment = assignments.find((a) => a.id === form.teaching_assignment_id);
      // A new placement of a V2 (delivery-group) assignment uses the V2 RPC, which also
      // enforces the assignment's hour budget; everything else uses the manual RPC.
      if (!sessionId && assignment?.delivery_group_id) {
        const version = versionQuery.data;
        if (!version) throw new Error("تعذر تحميل نسخة الجدول.");
        if (!form.room_id) throw new Error("اختر القاعة لجلسة الإسناد.");
        const res = await createScheduleSessionFromAssignmentV2({
          scheduleVersionId,
          teachingAssignmentId: assignment.id,
          dayOfWeek: form.day_of_week,
          startTime: form.start_time,
          endTime: form.end_time,
          roomId: form.room_id,
          expectedVersionUpdatedAt: version.updated_at,
        });
        if (!res.ok) {
          throw new SessionWriteError(
            res.message_ar ?? "تعذر حفظ المحاضرة.",
            [...res.blocking_conflicts, ...res.warnings].map((c) =>
              mapServerConflict(c as unknown as Record<string, unknown>),
            ),
          );
        }
        return;
      }
      await saveManualScheduleSession({
        sessionId: sessionId ?? null,
        expectedUpdatedAt: sessionRow?.updated_at ?? null,
        scheduleVersionId,
        form,
      });
    },
    onSuccess: async () => {
      toast.success("تم الحفظ");
      await invalidateSessionReadModels(qc);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof SessionWriteError && e.conflicts.length > 0) setConflicts(e.conflicts);
      toast.error((e as Error).message);
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!canMutate) throw new Error("العرض للقراءة فقط — لا يمكن الحذف");
      if (!sessionId || !sessionRow) return false;
      const confirmed = await confirmAction({
        title: "حذف المحاضرة",
        description: "سيتم حذف هذه المحاضرة من مسودة الجدول نهائياً. هل تريد المتابعة؟",
        confirmLabel: "حذف",
        destructive: true,
      });
      if (!confirmed) return false;
      await deleteScheduleSession({ sessionId, expectedUpdatedAt: sessionRow.updated_at });
      return true;
    },
    onSuccess: async (deleted) => {
      if (!deleted) return;
      toast.success("تم الحذف");
      await invalidateSessionReadModels(qc);
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const title = readOnly ? "عرض محاضرة" : sessionId ? "تعديل محاضرة" : "إضافة محاضرة";
  const loadingExisting = !!sessionId && sessionQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {readOnly && (
          <p className="text-sm text-muted-foreground -mt-1 mb-1">
            العرض للقراءة فقط — لا يمكن الحفظ أو الحذف أو التعديل.
          </p>
        )}
        {optionsError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            تعذر تحميل بيانات المحاضرة أو القوائم: {(optionsError as Error).message}
          </p>
        )}
        {loadingExisting ? (
          <p className="p-4 text-center text-sm text-muted-foreground">جارٍ تحميل المحاضرة...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>المقرر (Course Offering)</Label>
              <SearchableSelect
                ariaLabel="المقرر"
                placeholder="اختر المقرر"
                searchPlaceholder="ابحث باسم المقرر أو رمزه…"
                disabled={readOnly}
                value={form.course_offering_id || null}
                options={(offeringsQuery.data ?? []).map((o) => ({
                  value: o.id,
                  label: entityDisplayName(o.course ?? {}, "مقرر غير متاح"),
                  keywords: o.course?.code ?? "",
                }))}
                onChange={(v) =>
                  canMutate &&
                  setForm({
                    ...form,
                    course_offering_id: v ?? "",
                    teaching_assignment_id: null,
                  })
                }
              />
            </div>
            <div>
              <Label>الإسناد التدريسي</Label>
              <Select
                value={form.teaching_assignment_id ?? "none"}
                disabled={readOnly || !form.course_offering_id}
                onValueChange={(v) =>
                  canMutate &&
                  setForm({
                    ...form,
                    teaching_assignment_id: v === "none" ? null : v,
                    instructor_id:
                      v === "none"
                        ? form.instructor_id
                        : (assignments.find((t) => t.id === v)?.instructor_id ??
                          form.instructor_id),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختياري" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {assignments.map((t) => {
                    const ins = instructors.find((i) => i.id === t.instructor_id);
                    return (
                      <SelectItem key={t.id} value={t.id}>
                        {ins ? instructorDisplayName(ins) : "مدرس غير متاح"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المحاضر</Label>
              <SearchableSelect
                ariaLabel="المحاضر"
                placeholder="اختر المحاضر"
                searchPlaceholder="ابحث باسم المحاضر…"
                disabled={readOnly}
                value={form.instructor_id || null}
                options={instructors
                  // New scheduling: only available instructors; the current value stays visible.
                  .filter(
                    (i) => canReceiveNewWork(i.availability_status) || i.id === form.instructor_id,
                  )
                  .map((i) => ({
                    value: i.id,
                    label: `${instructorDisplayName(i)}${
                      !canReceiveNewWork(i.availability_status)
                        ? ` — ${availabilityStatusLabelAr(i.availability_status)}`
                        : ""
                    }`,
                  }))}
                onChange={(v) => canMutate && setForm({ ...form, instructor_id: v ?? "" })}
              />
            </div>
            <div>
              <Label>القاعة</Label>
              <SearchableSelect
                ariaLabel="القاعة"
                placeholder="اختياري"
                searchPlaceholder="ابحث باسم القاعة أو رمزها…"
                disabled={readOnly}
                allowNone
                value={form.room_id}
                options={(roomsQuery.data ?? []).map((r) => ({
                  value: r.id,
                  label: `${entityDisplayName(r)} (سعة ${r.capacity})`,
                  keywords: r.code ?? "",
                }))}
                onChange={(v) => canMutate && setForm({ ...form, room_id: v })}
              />
            </div>
            <div>
              <Label>المجموعة</Label>
              <Select
                value={form.section_id ?? "none"}
                disabled={readOnly}
                onValueChange={(v) =>
                  canMutate && setForm({ ...form, section_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختياري" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.section_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نظام الدراسة</Label>
              <Select
                value={form.study_system}
                disabled={readOnly}
                onValueChange={(v) =>
                  canMutate && setForm({ ...form, study_system: v as FormState["study_system"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">انتظام</SelectItem>
                  <SelectItem value="parallel">موازي</SelectItem>
                  <SelectItem value="both">الإثنين</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>اليوم</Label>
              <Select
                value={String(form.day_of_week)}
                disabled={readOnly}
                onValueChange={(v) => canMutate && setForm({ ...form, day_of_week: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">السبت</SelectItem>
                  <SelectItem value="0">الأحد</SelectItem>
                  <SelectItem value="1">الإثنين</SelectItem>
                  <SelectItem value="2">الثلاثاء</SelectItem>
                  <SelectItem value="3">الأربعاء</SelectItem>
                  <SelectItem value="4">الخميس</SelectItem>
                  <SelectItem value="5">الجمعة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع المحاضرة</Label>
              <Select
                value={form.session_type}
                disabled={readOnly}
                onValueChange={(v) => canMutate && setForm({ ...form, session_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lecture">محاضرة</SelectItem>
                  <SelectItem value="lab">معمل</SelectItem>
                  <SelectItem value="tutorial">تطبيق</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>من</Label>
              <Input
                type="time"
                disabled={readOnly}
                value={form.start_time.slice(0, 5)}
                onChange={(e) => {
                  if (!canMutate) return;
                  const start = e.target.value;
                  const dur = Math.max(60, toMin(form.end_time) - toMin(form.start_time) || 60);
                  setForm({ ...form, start_time: start, end_time: addMin(start, dur) });
                }}
              />
            </div>
            <div>
              <Label>المدة</Label>
              <Select
                value={String(
                  Math.max(1, Math.round((toMin(form.end_time) - toMin(form.start_time)) / 60)),
                )}
                disabled={readOnly}
                onValueChange={(v) =>
                  canMutate &&
                  setForm({ ...form, end_time: addMin(form.start_time, Number(v) * 60) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">ساعة واحدة</SelectItem>
                  <SelectItem value="2">ساعتان</SelectItem>
                  <SelectItem value="3">ثلاث ساعات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>العدد المتوقع</Label>
              <Input
                type="number"
                min={0}
                disabled={readOnly}
                value={form.expected_students}
                onChange={(e) =>
                  canMutate && setForm({ ...form, expected_students: Number(e.target.value) })
                }
              />
            </div>
          </div>
        )}

        <div className="mt-3 border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-semibold">مصدر المحاضرة:</span>
            <Badge
              variant={
                form.source_type === "manual"
                  ? "secondary"
                  : form.source_type === "auto_generated"
                    ? "default"
                    : "outline"
              }
            >
              {form.source_type === "manual"
                ? "يدوي"
                : form.source_type === "auto_generated"
                  ? "تلقائي"
                  : "منسوخ"}
            </Badge>
            {form.is_locked ? (
              <Badge variant="default" className="gap-1">
                <Lock className="h-3 w-3" /> مقفل
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Unlock className="h-3 w-3" /> غير مقفل
              </Badge>
            )}
          </div>
          {canMutate && (
            <div className="flex items-center gap-3">
              <Switch
                id="lock-switch"
                checked={form.is_locked}
                onCheckedChange={(v) =>
                  setForm({ ...form, is_locked: v, lock_reason: v ? form.lock_reason : null })
                }
              />
              <Label htmlFor="lock-switch" className="text-sm cursor-pointer">
                قفل المحاضرة (تمنع المجدول التلقائي من تحريكها أو حذفها)
              </Label>
            </div>
          )}
          {form.is_locked && (
            <div>
              <Label className="text-xs">سبب القفل</Label>
              <Textarea
                rows={2}
                disabled={readOnly}
                value={form.lock_reason ?? ""}
                onChange={(e) => canMutate && setForm({ ...form, lock_reason: e.target.value })}
                placeholder="مثال: قاعة ثابتة بطلب رئيس القسم"
              />
            </div>
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="mt-3 border border-destructive/40 rounded-md p-3 bg-destructive/5 space-y-2">
            <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" /> نتائج فحص التعارضات ({conflicts.length})
            </div>
            {conflicts.map((c, i) => (
              <div key={`${c.code}-${c.related_session_id ?? ""}-${i}`} className="text-xs">
                <Badge variant={c.severity === "hard" ? "destructive" : "outline"} className="me-1">
                  {c.severity === "hard" ? "إلزامي" : "تحذير"}
                </Badge>
                {c.message_ar}
                <div className="text-muted-foreground text-[10px]">{c.message_en}</div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {canMutate && sessionId && (
            <Button
              variant="destructive"
              onClick={() => del.mutate()}
              disabled={del.isPending || !sessionRow}
            >
              <Trash2 className="h-4 w-4 me-1" /> حذف
            </Button>
          )}
          {canMutate && (
            <Button variant="outline" onClick={runValidate} disabled={validating}>
              {validating ? "جاري التحقق..." : "تحقق من التعارضات"}
            </Button>
          )}
          {canMutate && (
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || loadingExisting || (!!sessionId && !sessionRow)}
            >
              حفظ
            </Button>
          )}
          {readOnly && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
