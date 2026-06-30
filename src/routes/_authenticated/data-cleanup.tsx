import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  Wrench, AlertTriangle, Library, UserSquare2, DoorOpen, ClipboardList,
  CheckCircle2, ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/data-cleanup")({
  head: () => ({ meta: [{ title: "تنظيف البيانات" }] }),
  component: DataCleanupPage,
});

// ---------- types ----------
type CourseRow = {
  id: string; code: string; name: string; course_nature: string | null;
  department_id: string | null;
};
type PlanCourseRow = {
  id: string; course_id: string; lectures_per_week: number | null; labs_per_week: number | null;
  lecture_session_duration: number | null; lab_session_duration: number | null;
  required_room_type_for_lecture: string | null; required_room_type_for_lab: string | null;
};
type InstructorRow = {
  id: string; full_name: string; specialization: string | null;
  department_id: string | null; instructor_type_id: string | null;
};
type RoomRow = {
  id: string; code: string; name: string; capacity: number; room_type_id: string | null; is_active: boolean;
};
type OfferingRow = {
  id: string; expected_students: number; study_plan_id: string | null; plan_course_id: string | null;
  study_system: string | null; course_id: string;
};

// ---------- data fetch ----------
async function fetchAll(collegeId: string) {
  const eq = (q: any) => q.eq("college_id", collegeId);
  const [
    courses, planCourses, instructors, availability, rooms, offerings, assignments, departments, instructorTypes, roomTypes,
  ] = await Promise.all([
    eq(supabase.from("courses").select("id, code, name, course_nature, department_id")),
    eq(supabase.from("plan_courses").select("id, course_id, lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab")),
    eq(supabase.from("instructors").select("id, full_name, specialization, department_id, instructor_type_id")),
    eq(supabase.from("instructor_availability").select("id, instructor_id")),
    eq(supabase.from("rooms").select("id, code, name, capacity, room_type_id, is_active")),
    eq(supabase.from("course_offerings").select("id, expected_students, study_plan_id, plan_course_id, study_system, course_id")),
    eq(supabase.from("teaching_assignments").select("id, course_offering_id")),
    eq(supabase.from("departments").select("id, name")),
    eq(supabase.from("instructor_types").select("id, name, code")),
    eq(supabase.from("room_types").select("id, name, code, default_capacity")),
  ]);
  return {
    courses: (courses.data ?? []) as CourseRow[],
    planCourses: (planCourses.data ?? []) as PlanCourseRow[],
    instructors: (instructors.data ?? []) as InstructorRow[],
    availability: (availability.data ?? []) as { id: string; instructor_id: string }[],
    rooms: (rooms.data ?? []) as RoomRow[],
    offerings: (offerings.data ?? []) as OfferingRow[],
    assignments: (assignments.data ?? []) as { id: string; course_offering_id: string }[],
    departments: (departments.data ?? []) as { id: string; name: string }[],
    instructorTypes: (instructorTypes.data ?? []) as { id: string; name: string; code: string | null }[],
    roomTypes: (roomTypes.data ?? []) as { id: string; name: string; code: string | null; default_capacity: number | null }[],
  };
}

// ---------- main ----------
function DataCleanupPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["data-cleanup", active?.id],
    queryFn: () => fetchAll(active!.id),
    enabled: !!active?.id,
  });

  const diag = useMemo(() => (data ? computeDiagnostics(data) : null), [data]);

  if (!active) {
    return (
      <div className="space-y-4" dir="rtl">
        <h1 className="text-2xl font-bold">تنظيف البيانات</h1>
        <Card className="p-6"><CollegeSwitcher /></Card>
      </div>
    );
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["data-cleanup", active.id] });

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-6 w-6" />
          <h1 className="text-2xl font-bold">تنظيف البيانات</h1>
        </div>
        <div className="flex items-center gap-2">
          <CollegeSwitcher />
          <Link to="/data-readiness" className="text-sm text-primary underline-offset-4 hover:underline">
            ← جاهزية البيانات
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        تشخيص مشاكل جودة البيانات الأكاديمية قبل الجدولة وإصلاحها جماعياً. لا تُجرى أي إصلاحات تلقائية — كل عملية تتطلب تأكيداً صريحاً وتُسجَّل في سجل التدقيق.
      </p>

      {/* Dashboard */}
      <DashboardCards diag={diag} loading={isLoading} />

      {!canManage && (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          أنت بوضع المشاهدة. يمكنك استعراض المشاكل دون تنفيذ إصلاحات.
        </Card>
      )}

      <Tabs defaultValue="courses" dir="rtl">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="courses"><Library className="ml-2 h-4 w-4" /> المقررات</TabsTrigger>
          <TabsTrigger value="instructors"><UserSquare2 className="ml-2 h-4 w-4" /> المحاضرون</TabsTrigger>
          <TabsTrigger value="rooms"><DoorOpen className="ml-2 h-4 w-4" /> القاعات</TabsTrigger>
          <TabsTrigger value="offerings"><ClipboardList className="ml-2 h-4 w-4" /> طرح المقررات</TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="mt-4">
          <CoursesSection data={data} diag={diag} canManage={canManage} onChanged={invalidate} collegeId={active.id} />
        </TabsContent>
        <TabsContent value="instructors" className="mt-4">
          <InstructorsSection data={data} diag={diag} canManage={canManage} onChanged={invalidate} collegeId={active.id} />
        </TabsContent>
        <TabsContent value="rooms" className="mt-4">
          <RoomsSection data={data} diag={diag} canManage={canManage} onChanged={invalidate} collegeId={active.id} />
        </TabsContent>
        <TabsContent value="offerings" className="mt-4">
          <OfferingsSection data={data} diag={diag} canManage={canManage} onChanged={invalidate} collegeId={active.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- diagnostics ----------
type IssueId =
  | "temp_codes" | "course_no_plan" | "course_missing_nature" | "course_no_pattern" | "course_no_room_req"
  | "ins_no_spec" | "ins_no_dept" | "ins_no_type" | "ins_no_avail"
  | "room_default_cap" | "room_no_type" | "room_dup_name" | "room_inactive"
  | "off_zero_students" | "off_no_assignment" | "off_no_system" | "off_no_plan_course";

type Issue = {
  id: IssueId;
  label: string;
  count: number;
  total: number;
  severity: "critical" | "medium" | "low";
  impactPct: number; // estimated readiness % impact
  ids: string[];
};

type Diagnostics = {
  issues: Record<IssueId, Issue>;
  readiness: number;
  estimatedAfter: number;
  critical: number;
  medium: number;
};

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

function computeDiagnostics(d: Awaited<ReturnType<typeof fetchAll>>): Diagnostics {
  const planCourseIds = new Set(d.planCourses.map((p) => p.course_id));
  const offeringCourseIds = new Set(d.offerings.map((o) => o.course_id));
  const assignedOfferingIds = new Set(d.assignments.map((a) => a.course_offering_id));
  const availInsIds = new Set(d.availability.map((a) => a.instructor_id));

  // Courses
  const tempCodes = d.courses.filter((c) => /^CRS-/i.test(c.code));
  const courseNoPlan = d.courses.filter((c) => !planCourseIds.has(c.id));
  const courseNoNature = d.courses.filter((c) => !c.course_nature);
  // Pattern + room requirements live on plan_courses
  const noPattern = d.planCourses.filter(
    (p) =>
      (Number(p.lectures_per_week ?? 0) === 0 && Number(p.labs_per_week ?? 0) === 0) ||
      ((p.lectures_per_week ?? 0) > 0 && !p.lecture_session_duration) ||
      ((p.labs_per_week ?? 0) > 0 && !p.lab_session_duration),
  );
  const noRoomReq = d.planCourses.filter(
    (p) =>
      ((p.lectures_per_week ?? 0) > 0 && !p.required_room_type_for_lecture) ||
      ((p.labs_per_week ?? 0) > 0 && !p.required_room_type_for_lab),
  );

  // Instructors
  const insNoSpec = d.instructors.filter((i) => !i.specialization);
  const insNoDept = d.instructors.filter((i) => !i.department_id);
  const insNoType = d.instructors.filter((i) => !i.instructor_type_id);
  const insNoAvail = d.instructors.filter((i) => !availInsIds.has(i.id));

  // Rooms
  const roomDefaultCap = d.rooms.filter((r) => r.capacity === 30);
  const roomNoType = d.rooms.filter((r) => !r.room_type_id);
  const nameCounts = new Map<string, number>();
  d.rooms.forEach((r) => {
    const k = r.name.trim().toLowerCase();
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  });
  const roomDupName = d.rooms.filter((r) => (nameCounts.get(r.name.trim().toLowerCase()) ?? 0) > 1);
  const roomInactive = d.rooms.filter((r) => !r.is_active);

  // Offerings
  const offZero = d.offerings.filter((o) => Number(o.expected_students ?? 0) === 0);
  const offNoAssign = d.offerings.filter((o) => !assignedOfferingIds.has(o.id));
  const offNoSystem = d.offerings.filter((o) => !o.study_system);
  const offNoPlanCourse = d.offerings.filter((o) => !o.plan_course_id);

  const totals = {
    courses: d.courses.length, planCourses: d.planCourses.length,
    instructors: d.instructors.length, rooms: d.rooms.length, offerings: d.offerings.length,
  };

  const mk = (id: IssueId, label: string, rows: { id: string }[], total: number, severity: Issue["severity"], factor: number): Issue => {
    const p = pct(rows.length, total);
    return {
      id, label,
      count: rows.length, total,
      severity, impactPct: Math.round(p * factor),
      ids: rows.map((r) => r.id),
    };
  };

  const issues: Record<IssueId, Issue> = {
    temp_codes: mk("temp_codes", "مقررات برموز مؤقتة (CRS-)", tempCodes, totals.courses, "critical", 0.4),
    course_no_plan: mk("course_no_plan", "مقررات غير مرتبطة بأي خطة دراسية", courseNoPlan, totals.courses, "medium", 0.3),
    course_missing_nature: mk("course_missing_nature", "مقررات بدون طبيعة (course_nature)", courseNoNature, totals.courses, "low", 0.1),
    course_no_pattern: mk("course_no_pattern", "مقررات الخطة بدون نمط جلسات صحيح", noPattern, totals.planCourses, "critical", 0.5),
    course_no_room_req: mk("course_no_room_req", "مقررات الخطة بدون متطلبات قاعة", noRoomReq, totals.planCourses, "medium", 0.3),

    ins_no_spec: mk("ins_no_spec", "محاضرون بدون تخصص", insNoSpec, totals.instructors, "medium", 0.2),
    ins_no_dept: mk("ins_no_dept", "محاضرون بدون قسم", insNoDept, totals.instructors, "critical", 0.4),
    ins_no_type: mk("ins_no_type", "محاضرون بدون نوع", insNoType, totals.instructors, "medium", 0.2),
    ins_no_avail: mk("ins_no_avail", "محاضرون بدون توفّر مسجّل", insNoAvail, totals.instructors, "medium", 0.3),

    room_default_cap: mk("room_default_cap", "قاعات بسعة افتراضية (30)", roomDefaultCap, totals.rooms, "medium", 0.2),
    room_no_type: mk("room_no_type", "قاعات بدون نوع", roomNoType, totals.rooms, "critical", 0.4),
    room_dup_name: mk("room_dup_name", "قاعات بأسماء مكررة", roomDupName, totals.rooms, "low", 0.1),
    room_inactive: mk("room_inactive", "قاعات غير نشطة", roomInactive, totals.rooms, "low", 0.05),

    off_zero_students: mk("off_zero_students", "طرح بـ expected_students = 0", offZero, totals.offerings, "critical", 0.5),
    off_no_assignment: mk("off_no_assignment", "طرح بدون تكليف تدريسي", offNoAssign, totals.offerings, "critical", 0.5),
    off_no_system: mk("off_no_system", "طرح بدون نظام دراسة", offNoSystem, totals.offerings, "low", 0.1),
    off_no_plan_course: mk("off_no_plan_course", "طرح غير مرتبط بمقرر خطة", offNoPlanCourse, totals.offerings, "medium", 0.3),
  };

  // overall readiness: 100 - sum of weighted impacts (capped)
  const totalImpact = Object.values(issues).reduce((s, i) => s + i.impactPct, 0);
  const readiness = Math.max(0, 100 - Math.min(100, Math.round(totalImpact / 6)));
  const estimatedAfter = 100; // after fixing all
  const critical = Object.values(issues).filter((i) => i.severity === "critical" && i.count > 0).length;
  const medium = Object.values(issues).filter((i) => i.severity === "medium" && i.count > 0).length;
  return { issues, readiness, estimatedAfter, critical, medium };
}

// ---------- dashboard ----------
function DashboardCards({ diag, loading }: { diag: Diagnostics | null; loading: boolean }) {
  if (loading || !diag) {
    return <Card className="p-6 text-muted-foreground">جارٍ التحميل...</Card>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">الجاهزية الحالية</div>
        <div className="mt-1 text-3xl font-bold">{diag.readiness}%</div>
        <Progress value={diag.readiness} className="mt-2 h-2" />
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">الجاهزية المتوقّعة بعد الإصلاح</div>
        <div className="mt-1 text-3xl font-bold text-emerald-600">{diag.estimatedAfter}%</div>
        <Progress value={diag.estimatedAfter} className="mt-2 h-2" />
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="h-4 w-4" /> مشاكل حرجة</div>
        <div className="mt-1 text-3xl font-bold text-red-600">{diag.critical}</div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4" /> مشاكل متوسطة</div>
        <div className="mt-1 text-3xl font-bold text-amber-600">{diag.medium}</div>
      </Card>
    </div>
  );
}

// ---------- shared issue row ----------
function IssueRow({
  issue, actions,
}: {
  issue: Issue | undefined;
  actions?: React.ReactNode;
}) {
  if (!issue) return null;
  const p = pct(issue.count, issue.total);
  const okay = issue.count === 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {okay ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : issue.severity === "critical" ? (
            <ShieldAlert className="h-4 w-4 text-red-600" />
          ) : issue.severity === "medium" ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{issue.label}</span>
          <Badge variant="outline" className="text-[10px]">{issue.count}/{issue.total}</Badge>
          <Badge variant="secondary" className="text-[10px]">{p}%</Badge>
          {!okay && issue.impactPct > 0 && (
            <Badge className="bg-rose-100 text-[10px] text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
              يقلل الجاهزية ~{issue.impactPct}%
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {okay
            ? "لا توجد مشاكل في هذا البند."
            : `${issue.count} عنصر يحتاج المراجعة، ما يمثّل ${p}% من الإجمالي.`}
        </div>
      </div>
      {!okay && actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- bulk dialog (generic) ----------
function BulkDialog({
  open, onOpenChange, title, description, ids, children, onConfirm, confirmLabel = "تنفيذ",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  ids: string[];
  children?: React.ReactNode;
  onConfirm: (selected: string[]) => Promise<void> | void;
  confirmLabel?: string;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // reset selection when opening
  const allSelectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  const handleOpen = (v: boolean) => {
    if (v) {
      const next: Record<string, boolean> = {};
      ids.forEach((id) => (next[id] = true));
      setSelected(next);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            سيتم تطبيق العملية على <strong>{allSelectedIds.length}</strong> من أصل <strong>{ids.length}</strong> عنصر.
            {ids.length > 0 && (
              <button
                type="button"
                className="mr-2 text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  const allSelected = ids.every((id) => selected[id]);
                  const next: Record<string, boolean> = {};
                  ids.forEach((id) => (next[id] = !allSelected));
                  setSelected(next);
                }}
              >
                {ids.every((id) => selected[id]) ? "إلغاء التحديد" : "تحديد الكل"}
              </button>
            )}
          </div>
          {children}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpen(false)} disabled={busy}>إلغاء</Button>
          <Button
            disabled={busy || allSelectedIds.length === 0}
            onClick={async () => {
              try {
                setBusy(true);
                await onConfirm(allSelectedIds);
                handleOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "جارٍ التنفيذ..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- COURSES ----------
function CoursesSection({
  data, diag, canManage, onChanged, collegeId,
}: {
  data: Awaited<ReturnType<typeof fetchAll>> | undefined;
  diag: Diagnostics | null;
  canManage: boolean;
  onChanged: () => void;
  collegeId: string;
}) {
  const [dlg, setDlg] = useState<null | "temp_codes" | "nature" | "room_req">(null);
  const issues = diag?.issues;

  // dialog state
  const [codePrefix, setCodePrefix] = useState("");
  const [natureVal, setNatureVal] = useState<"department" | "college" | "university">("department");
  const [lectureRoom, setLectureRoom] = useState("lecture_hall");
  const [labRoom, setLabRoom] = useState("computer_lab");

  const tempIds = issues?.temp_codes.ids ?? [];
  const natureIds = issues?.course_missing_nature.ids ?? [];
  const roomReqIds = issues?.course_no_room_req.ids ?? [];

  return (
    <Card className="space-y-3 p-4">
      <IssueRow issue={issues?.temp_codes} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("temp_codes")}>تحديث جماعي للرموز</Button>
      ) : null} />
      <IssueRow issue={issues?.course_no_plan} />
      <IssueRow issue={issues?.course_missing_nature} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("nature")}>تعيين طبيعة المقرر</Button>
      ) : null} />
      <IssueRow issue={issues?.course_no_pattern} />
      <IssueRow issue={issues?.course_no_room_req} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("room_req")}>تعيين متطلبات القاعة</Button>
      ) : null} />

      <BulkDialog
        open={dlg === "temp_codes"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للرموز المؤقتة (CRS-)"
        description="سيُستبدل بادئة CRS- بالبادئة الجديدة مع الحفاظ على الجزء الرقمي."
        ids={tempIds}
        confirmLabel="تطبيق التحديث"
        onConfirm={async (ids) => {
          if (!codePrefix.trim()) { toast.error("أدخل البادئة الجديدة"); return; }
          const rows = (data?.courses ?? []).filter((c) => ids.includes(c.id));
          const updates = await Promise.all(rows.map(async (c) => {
            const newCode = c.code.replace(/^CRS-/i, `${codePrefix.trim()}-`);
            const { error } = await supabase.from("courses").update({ code: newCode }).eq("id", c.id);
            return { id: c.id, error };
          }));
          const failed = updates.filter((u) => u.error).length;
          await logAudit({ action: "bulk_update", entity: "courses",
            collegeId, details: { kind: "code_prefix_rename", count: ids.length, prefix: codePrefix, failed } });
          if (failed) toast.error(`تم التحديث مع فشل ${failed} عنصر`);
          else toast.success(`تم تحديث رموز ${ids.length} مقرر`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>البادئة الجديدة (بدون شرطة)</Label>
          <Input value={codePrefix} onChange={(e) => setCodePrefix(e.target.value)} placeholder="مثال: CS, IT, CYS" />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "nature"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين طبيعة المقرر"
        ids={natureIds}
        onConfirm={async (ids) => {
          const { error } = await supabase.from("courses").update({ course_nature: natureVal }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "courses",
            collegeId, details: { kind: "course_nature", value: natureVal, count: ids.length } });
          toast.success(`تم تعيين الطبيعة لـ ${ids.length} مقرر`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>الطبيعة</Label>
          <Select value={natureVal} onValueChange={(v) => setNatureVal(v as typeof natureVal)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="department">قسم</SelectItem>
              <SelectItem value="college">كلية</SelectItem>
              <SelectItem value="university">جامعة</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "room_req"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين متطلبات نوع القاعة (لمقررات الخطة)"
        description="يُطبَّق فقط حيث القيمة فارغة، ووفقاً لوجود محاضرات/مختبرات."
        ids={roomReqIds}
        onConfirm={async (ids) => {
          const rows = (data?.planCourses ?? []).filter((p) => ids.includes(p.id));
          let ok = 0, fail = 0;
          for (const r of rows) {
            const upd: { required_room_type_for_lecture?: string; required_room_type_for_lab?: string } = {};
            if ((r.lectures_per_week ?? 0) > 0 && !r.required_room_type_for_lecture) upd.required_room_type_for_lecture = lectureRoom;
            if ((r.labs_per_week ?? 0) > 0 && !r.required_room_type_for_lab) upd.required_room_type_for_lab = labRoom;
            if (Object.keys(upd).length === 0) continue;
            const { error } = await supabase.from("plan_courses").update(upd).eq("id", r.id);
            if (error) fail++; else ok++;
          }
          await logAudit({ action: "bulk_update", entity: "plan_courses",
            collegeId, details: { kind: "room_requirements", lecture: lectureRoom, lab: labRoom, ok, fail } });
          toast.success(`تم تحديث ${ok} مقرر خطة${fail ? ` (فشل ${fail})` : ""}`);
          onChanged();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>قاعة المحاضرة</Label>
            <Select value={lectureRoom} onValueChange={setLectureRoom}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lecture_room">قاعة محاضرات</SelectItem>
                <SelectItem value="auditorium">مدرّج</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>قاعة المختبر</Label>
            <Select value={labRoom} onValueChange={setLabRoom}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="computer_lab">مختبر حاسوب</SelectItem>
                <SelectItem value="network_lab">مختبر شبكات</SelectItem>
                <SelectItem value="general_lab">مختبر عام</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </BulkDialog>
    </Card>
  );
}

// ---------- INSTRUCTORS ----------
function InstructorsSection({
  data, diag, canManage, onChanged, collegeId,
}: {
  data: Awaited<ReturnType<typeof fetchAll>> | undefined;
  diag: Diagnostics | null;
  canManage: boolean;
  onChanged: () => void;
  collegeId: string;
}) {
  const issues = diag?.issues;
  const [dlg, setDlg] = useState<null | "dept" | "spec" | "type">(null);
  const [deptId, setDeptId] = useState<string>("");
  const [spec, setSpec] = useState("");
  const [typeId, setTypeId] = useState<string>("");

  return (
    <Card className="space-y-3 p-4">
      <IssueRow issue={issues?.ins_no_spec} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("spec")}>تعيين التخصص</Button>
      ) : null} />
      <IssueRow issue={issues?.ins_no_dept} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("dept")}>تعيين القسم</Button>
      ) : null} />
      <IssueRow issue={issues?.ins_no_type} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("type")}>تعيين النوع</Button>
      ) : null} />
      <IssueRow issue={issues?.ins_no_avail} />

      <BulkDialog
        open={dlg === "dept"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين القسم للمحاضرين"
        ids={issues?.ins_no_dept.ids ?? []}
        onConfirm={async (ids) => {
          if (!deptId) { toast.error("اختر قسماً"); return; }
          const { error } = await supabase.from("instructors").update({ department_id: deptId }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "instructors",
            collegeId, details: { kind: "department", value: deptId, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} محاضر`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>القسم</Label>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger><SelectValue placeholder="اختر قسماً..." /></SelectTrigger>
            <SelectContent>
              {(data?.departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "spec"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين التخصص للمحاضرين"
        ids={issues?.ins_no_spec.ids ?? []}
        onConfirm={async (ids) => {
          if (!spec.trim()) { toast.error("أدخل التخصص"); return; }
          const { error } = await supabase.from("instructors").update({ specialization: spec.trim() }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "instructors",
            collegeId, details: { kind: "specialization", value: spec.trim(), count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} محاضر`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>التخصص</Label>
          <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="مثال: علوم الحاسب" />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "type"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نوع المحاضر"
        ids={issues?.ins_no_type.ids ?? []}
        onConfirm={async (ids) => {
          if (!typeId) { toast.error("اختر النوع"); return; }
          const { error } = await supabase.from("instructors").update({ instructor_type_id: typeId }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "instructors",
            collegeId, details: { kind: "instructor_type", value: typeId, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} محاضر`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>النوع</Label>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger><SelectValue placeholder="اختر النوع..." /></SelectTrigger>
            <SelectContent>
              {(data?.instructorTypes ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>
    </Card>
  );
}

// ---------- ROOMS ----------
function RoomsSection({
  data, diag, canManage, onChanged, collegeId,
}: {
  data: Awaited<ReturnType<typeof fetchAll>> | undefined;
  diag: Diagnostics | null;
  canManage: boolean;
  onChanged: () => void;
  collegeId: string;
}) {
  const issues = diag?.issues;
  const [dlg, setDlg] = useState<null | "cap" | "type">(null);
  const [cap, setCap] = useState<number>(40);
  const [roomTypeId, setRoomTypeId] = useState<string>("");

  return (
    <Card className="space-y-3 p-4">
      <IssueRow issue={issues?.room_default_cap} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("cap")}>تحديث السعة</Button>
      ) : null} />
      <IssueRow issue={issues?.room_no_type} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("type")}>تعيين نوع القاعة</Button>
      ) : null} />
      <IssueRow issue={issues?.room_dup_name} />
      <IssueRow issue={issues?.room_inactive} />

      <BulkDialog
        open={dlg === "cap"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للسعة"
        ids={issues?.room_default_cap.ids ?? []}
        onConfirm={async (ids) => {
          if (!Number.isFinite(cap) || cap <= 0) { toast.error("سعة غير صحيحة"); return; }
          const { error } = await supabase.from("rooms").update({ capacity: cap }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "rooms",
            collegeId, details: { kind: "capacity", value: cap, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} قاعة`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>السعة الجديدة</Label>
          <Input type="number" min={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "type"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نوع القاعة"
        ids={issues?.room_no_type.ids ?? []}
        onConfirm={async (ids) => {
          if (!roomTypeId) { toast.error("اختر النوع"); return; }
          const rt = (data?.roomTypes ?? []).find((t) => t.id === roomTypeId);
          const upd: { room_type_id: string; room_type?: string } = { room_type_id: roomTypeId };
          // also sync legacy text column if code maps to allowed enum
          if (rt?.code && ["lecture_room", "computer_lab", "network_lab", "general_lab", "auditorium"].includes(rt.code)) {
            upd.room_type = rt.code;
          }
          const { error } = await supabase.from("rooms").update(upd).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "rooms",
            collegeId, details: { kind: "room_type", value: roomTypeId, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} قاعة`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>النوع</Label>
          <Select value={roomTypeId} onValueChange={setRoomTypeId}>
            <SelectTrigger><SelectValue placeholder="اختر النوع..." /></SelectTrigger>
            <SelectContent>
              {(data?.roomTypes ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>
    </Card>
  );
}

// ---------- OFFERINGS ----------
function OfferingsSection({
  data, diag, canManage, onChanged, collegeId,
}: {
  data: Awaited<ReturnType<typeof fetchAll>> | undefined;
  diag: Diagnostics | null;
  canManage: boolean;
  onChanged: () => void;
  collegeId: string;
}) {
  const issues = diag?.issues;
  const [dlg, setDlg] = useState<null | "students" | "system">(null);
  const [students, setStudents] = useState<number>(30);
  const [system, setSystem] = useState<"regular" | "parallel" | "both">("regular");

  return (
    <Card className="space-y-3 p-4">
      <IssueRow issue={issues?.off_zero_students} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("students")}>تحديث expected_students</Button>
      ) : null} />
      <IssueRow issue={issues?.off_no_assignment} />
      <IssueRow issue={issues?.off_no_system} actions={canManage ? (
        <Button size="sm" onClick={() => setDlg("system")}>تعيين نظام الدراسة</Button>
      ) : null} />
      <IssueRow issue={issues?.off_no_plan_course} />

      <BulkDialog
        open={dlg === "students"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للطلاب المتوقعين"
        ids={issues?.off_zero_students.ids ?? []}
        onConfirm={async (ids) => {
          if (!Number.isFinite(students) || students <= 0) { toast.error("قيمة غير صحيحة"); return; }
          const { error } = await supabase.from("course_offerings").update({ expected_students: students }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "course_offerings",
            collegeId, details: { kind: "expected_students", value: students, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} طرح`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>عدد الطلاب المتوقع</Label>
          <Input type="number" min={1} value={students} onChange={(e) => setStudents(Number(e.target.value))} />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "system"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نظام الدراسة"
        ids={issues?.off_no_system.ids ?? []}
        onConfirm={async (ids) => {
          const { error } = await supabase.from("course_offerings").update({ study_system: system }).in("id", ids);
          if (error) { toast.error(error.message); return; }
          await logAudit({ action: "bulk_update", entity: "course_offerings",
            collegeId, details: { kind: "study_system", value: system, count: ids.length } });
          toast.success(`تم التحديث لـ ${ids.length} طرح`);
          onChanged();
        }}
      >
        <div className="space-y-2">
          <Label>النظام</Label>
          <Select value={system} onValueChange={(v) => setSystem(v as typeof system)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">انتظام</SelectItem>
              <SelectItem value="parallel">موازي</SelectItem>
              <SelectItem value="both">كلاهما</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>
    </Card>
  );
}

// suppress unused-import lint warning
void Checkbox;
