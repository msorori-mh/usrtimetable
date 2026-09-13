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
  fetchDeliveryCoverage,
  fetchDeliveryGaps,
  type DeliveryCoverage,
} from "@/lib/schedule-versions/delivery-coverage";

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
}: {
  collegeId: string;
  scheduleVersionId: string;
  coverage: DeliveryCoverage | undefined;
  isLoading?: boolean;
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

  return (
    <div
      className={`space-y-2 rounded-md border p-2 ${
        complete
          ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-destructive/40 bg-destructive/5"
      }`}
      data-testid="delivery-coverage-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold">اكتمال نسخة الجدول</span>
        {complete ? (
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
        <Row
          label="المجموعات المجدولة"
          value={`${coverage.groupsWithSessions}/${coverage.totalGroups}`}
        />
        <Row
          label="الساعات المجدولة"
          value={`${coverage.scheduledHours}/${coverage.requiredHours}`}
        />
        <Row label="غير المجدول" value={`${coverage.groupsWithoutSessions} مجموعة`} />
        <Row label="الساعات الناقصة" value={`${coverage.missingHours}`} />
        {coverage.multiAssignedGroups > 0 && (
          <Row label="إسناد مزدوج" value={`${coverage.multiAssignedGroups}`} />
        )}
      </div>

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
}: {
  collegeId: string;
  scheduleVersionId: string;
  onClose: () => void;
}) {
  const gaps = useQuery({
    queryKey: ["sv-delivery-gaps", collegeId, scheduleVersionId],
    queryFn: () => fetchDeliveryGaps({ collegeId, scheduleVersionId }),
  });

  return (
    <Dialog open onOpenChange={(b) => !b && onClose()}>
      <DialogContent dir="rtl" className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>نواقص نسخة الجدول</DialogTitle>
          <DialogDescription>
            كل مجموعة محاضرات/معامل لم تُستكمل في هذه النسخة، مع الساعات المطلوبة والمجدولة والناقصة.
          </DialogDescription>
        </DialogHeader>
        {gaps.isLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : gaps.isError ? (
          <p className="text-sm text-destructive">تعذّر تحميل النواقص.</p>
        ) : (gaps.data ?? []).length === 0 ? (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {(gaps.data ?? []).map((g) => (
                  <TableRow key={g.delivery_group_id}>
                    <TableCell>{g.program_name ?? g.program_code ?? "—"}</TableCell>
                    <TableCell>
                      {SYSTEM_LABEL[g.study_system ?? ""] ?? g.study_system ?? "—"}
                    </TableCell>
                    <TableCell>{g.level_name ?? g.level_number ?? "—"}</TableCell>
                    <TableCell>{g.cohort_code ?? "—"}</TableCell>
                    <TableCell>
                      {g.course_code ?? "—"} {g.course_name ? `— ${g.course_name}` : ""}
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
