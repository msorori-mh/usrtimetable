import { filterDeliveryGaps } from "@/lib/auto-scheduler/study-system-scope";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deliveryGroupStates,
  fetchDeliveryCoverage,
  fetchDeliveryGaps,
  type DeliveryCoverage,
} from "@/lib/schedule-versions/delivery-coverage";
import { entityDisplayName } from "@/lib/entity-display";

const SYSTEM_LABEL: Record<string, string> = {
  regular: "عام",
  parallel: "موازي",
  distance: "تعليم عن بعد",
};

const COMPONENT_LABEL: Record<string, string> = {
  lecture: "نظري",
  lab: "عملي",
  tutorial: "تمارين",
  training: "تدريب",
  project: "مشروع",
  seminar: "حلقة نقاش",
  workshop: "ورشة",
};

const STATE_LABEL: Record<string, string> = {
  unscheduled: "غير مجدول",
  unassigned: "بدون إسناد",
  short_hours: "ساعات ناقصة",
  multi_assigned: "إسناد مزدوج",
  over_hours: "ساعات زائدة",
};

/** Read-only coverage query — the database guards stay the final authority. */
export function useDeliveryCoverage(params: {
  collegeId: string | null | undefined;
  scheduleVersionId: string | null | undefined;
  enabled?: boolean;
}) {
  const { collegeId, scheduleVersionId, enabled = true } = params;
  return useQuery({
    queryKey: ["sv-delivery-coverage", collegeId, scheduleVersionId],
    enabled: enabled && !!collegeId && !!scheduleVersionId,
    queryFn: () =>
      fetchDeliveryCoverage({ collegeId: collegeId!, scheduleVersionId: scheduleVersionId! }),
  });
}

export function DeliveryCoverageCard({
  collegeId,
  scheduleVersionId,
  coverage,
  isLoading,
  studySystem = "all",
}: {
  collegeId: string;
  scheduleVersionId: string;
  coverage: DeliveryCoverage | undefined;
  isLoading?: boolean;
  studySystem?: string;
}) {
  const [gapsOpen, setGapsOpen] = useState(false);

  if (isLoading && !coverage) {
    return (
      <div className="rounded-md border p-2 text-[11px] text-muted-foreground">
        جارٍ حساب اكتمال نسخة الجدول...
      </div>
    );
  }
  if (!coverage) return null;

  const complete = coverage.complete;
  const states = deliveryGroupStates(coverage);
  const temporaryException =
    complete &&
    coverage.temporaryAssignmentException &&
    coverage.provisionalSourceGroups === coverage.unassignedGroups &&
    coverage.unassignedGroups > 0;

  return (
    <div
      className={`space-y-2 rounded-md border p-2 ${
        temporaryException
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30"
          : complete
            ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
            : "border-destructive/40 bg-destructive/5"
      }`}
      data-testid="delivery-coverage-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold">اكتمال نسخة الجدول — جميع الأنظمة</span>
        {temporaryException ? (
          <Badge variant="outline" className="gap-1 border-amber-600 text-amber-800">
            <AlertTriangle className="h-3 w-3" /> استثناء الفصل الحالي
          </Badge>
        ) : complete ? (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> مكتمل 100%
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> غير مكتمل
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <Row
          label="المجموعات المسندة"
          value={`${coverage.assignedExactlyOnce}/${coverage.totalGroups}`}
        />
        <Row label="مكتملة الساعات" value={`${states.complete}/${coverage.totalGroups} مجموعة`} />
        <Row label="مجموعات جزئية" value={`${states.partial} مجموعة`} />
        <Row label="غير مبدوءة" value={`${states.notStarted} مجموعة`} />
        <Row
          label="الساعات المكتملة"
          value={`${coverage.scheduledHours}/${coverage.requiredHours}`}
        />
        {temporaryException && (
          <Row label="مجموعات دون تكليف معتمد" value={String(coverage.provisionalSourceGroups)} />
        )}
        <Row label="الساعات الناقصة" value={`${coverage.missingHours} ساعة`} />
        {states.overScheduled > 0 && (
          <Row label="زائدة الساعات" value={`${states.overScheduled} مجموعة`} />
        )}
        {coverage.multiAssignedGroups > 0 && (
          <Row label="إسناد مزدوج" value={`${coverage.multiAssignedGroups}`} />
        )}
      </div>

      {temporaryException && (
        <p className="text-[11px] text-amber-900 dark:text-amber-200">
          هذه المجموعات لها جلسات وأسماء مدرسين من جداول الفصل، لكن استثناء النشر لا يعتمد التكليف
          الإداري أو المالي.
        </p>
      )}

      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => setGapsOpen(true)}
        data-testid="delivery-coverage-gaps-trigger"
      >
        <ListChecks className="h-4 w-4 ml-1" /> عرض النواقص
      </Button>

      {gapsOpen && (
        <GapsDialog
          collegeId={collegeId}
          scheduleVersionId={scheduleVersionId}
          studySystem={studySystem}
          onClose={() => setGapsOpen(false)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function GapsDialog({
  collegeId,
  scheduleVersionId,
  onClose,
  studySystem,
}: {
  collegeId: string;
  scheduleVersionId: string;
  onClose: () => void;
  studySystem: string;
}) {
  const gaps = useQuery({
    queryKey: ["sv-delivery-gaps", collegeId, scheduleVersionId],
    queryFn: () => fetchDeliveryGaps({ collegeId, scheduleVersionId }),
  });

  const visibleGaps = filterDeliveryGaps(gaps.data ?? [], studySystem);
  return (
    <Dialog open onOpenChange={(b) => !b && onClose()}>
      <DialogContent dir="rtl" className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            نواقص نسخة الجدول — {SYSTEM_LABEL[studySystem] ?? "جميع الأنظمة"}
          </DialogTitle>
          <DialogDescription>
            كل مجموعة محاضرات/معامل لم تُستكمل في النطاق المختار، مع الساعات المطلوبة والمجدولة
            والناقصة.
          </DialogDescription>
        </DialogHeader>
        {gaps.isLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : gaps.isError ? (
          <p className="text-sm text-destructive">تعذّر تحميل النواقص.</p>
        ) : visibleGaps.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="delivery-gaps-empty">
            لا توجد نواقص — التغطية مكتملة.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table data-testid="delivery-gaps-table">
              <TableHeader>
                <TableRow>
                  <TableHead>البرنامج</TableHead>
                  <TableHead>النظام</TableHead>
                  <TableHead>المستوى</TableHead>
                  <TableHead>الدفعة</TableHead>
                  <TableHead>المقرر</TableHead>
                  <TableHead>المكوّن</TableHead>
                  <TableHead>المجموعة</TableHead>
                  <TableHead>الطلاب</TableHead>
                  <TableHead>المدرس</TableHead>
                  <TableHead>المطلوب</TableHead>
                  <TableHead>المجدول</TableHead>
                  <TableHead>الناقص</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تفسير النقص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleGaps.map((g) => (
                  <TableRow key={g.delivery_group_id}>
                    <TableCell>{g.program_name ?? g.program_code ?? "—"}</TableCell>
                    <TableCell>
                      {SYSTEM_LABEL[g.study_system ?? ""] ?? g.study_system ?? "—"}
                    </TableCell>
                    <TableCell>{g.level_name ?? g.level_number ?? "—"}</TableCell>
                    <TableCell>{g.cohort_code ?? "—"}</TableCell>
                    <TableCell>
                      {entityDisplayName({ name: g.course_name, code: g.course_code })}
                    </TableCell>
                    <TableCell>
                      {COMPONENT_LABEL[g.component_type ?? ""] ?? g.component_type ?? "—"}
                    </TableCell>
                    <TableCell>{g.group_code ?? g.group_number ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{g.expected_students ?? "—"}</TableCell>
                    <TableCell>{g.instructor_names || "غير مسند"}</TableCell>
                    <TableCell className="tabular-nums">{g.required_hours ?? 0}</TableCell>
                    <TableCell className="tabular-nums">{g.scheduled_hours ?? 0}</TableCell>
                    <TableCell className="tabular-nums font-semibold text-destructive">
                      {g.missing_hours ?? 0}
                    </TableCell>
                    <TableCell>
                      {STATE_LABEL[g.scheduling_state ?? ""] ?? g.scheduling_state ?? "—"}
                    </TableCell>
                    <TableCell className="min-w-52 text-xs text-muted-foreground">
                      {gapReason(g.scheduling_state, g.instructor_names)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function gapReason(state: string | null, instructorNames: string | null): string {
  if (state === "unassigned" || !instructorNames) return "لا يوجد إسناد تدريس معتمد للمجموعة.";
  if (state === "unscheduled")
    return "لم تُنشأ أي جلسة؛ راجع سبب القيد التفصيلي في نتيجة آخر تشغيل.";
  if (state === "short_hours")
    return "جُدول جزء من الساعات فقط؛ راجع نتيجة آخر تشغيل لمعرفة قيد الوقت أو القاعة.";
  if (state === "multi_assigned") return "للمجموعة أكثر من إسناد نشط ويجب تصحيح الإسناد.";
  if (state === "over_hours") return "الساعات المجدولة تتجاوز الساعات المطلوبة.";
  return "راجع نتيجة آخر تشغيل لمعرفة القيد التفصيلي.";
}
