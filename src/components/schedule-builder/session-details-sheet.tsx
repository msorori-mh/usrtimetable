/**
 * Read-only session details panel for Schedule Builder workspace.
 * Close only — no save / edit / remove / publish / generation actions.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SESSION_TYPE_LABELS,
  SESSION_STUDY_SYSTEM_LABELS,
} from "@/lib/reports/session-mappers";
import type { WorkspaceSessionView } from "@/lib/schedule-builder/workspace";
import { DAY_NAMES_AR } from "@/lib/reports/formatters";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

export function SessionDetailsSheet({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkspaceSessionView | null;
}) {
  const typeLabel = session
    ? (SESSION_TYPE_LABELS[session.session_type] ?? session.session_type)
    : "";
  const sysLabel = session
    ? (SESSION_STUDY_SYSTEM_LABELS[session.study_system] ?? session.study_system)
    : "";
  const dayLabel = session
    ? (DAY_NAMES_AR[session.day_of_week] ?? String(session.day_of_week))
    : "";
  const start = session ? String(session.start_time).slice(0, 5) : "";
  const end = session ? String(session.end_time).slice(0, 5) : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle>تفاصيل الجلسة</SheetTitle>
          <SheetDescription>عرض فقط — لا توجد إجراءات حفظ من هذه اللوحة.</SheetDescription>
        </SheetHeader>

        {session ? (
          <div className="mt-4 space-y-1">
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="outline">{typeLabel}</Badge>
              <Badge variant="secondary">{sysLabel}</Badge>
            </div>
            <dl>
              <Row label="المقرر" value={`${session.course_code} — ${session.course_name}`} />
              <Row label="رمز المقرر" value={session.course_code} />
              <Row label="الشعبة" value={session.section_number} />
              <Row label="البرنامج" value={session.program_name} />
              <Row label="المستوى" value={session.level_name} />
              <Row label="القسم" value={session.department_name} />
              <Row label="المدرس" value={session.instructor_name} />
              <Row label="القاعة / المعمل" value={session.room_label} />
              <Row label="اليوم" value={dayLabel} />
              <Row label="الوقت" value={`${start} – ${end}`} />
              <Row label="نوع الجلسة" value={typeLabel} />
              <Row label="النظام الدراسي" value={sysLabel} />
            </dl>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">لم تُحدد جلسة.</p>
        )}

        <SheetFooter className="mt-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
