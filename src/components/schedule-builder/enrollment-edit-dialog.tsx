/**
 * Explicit enrollment ownership dialog — save only on "حفظ واعتماد".
 * Independent of session pending local edits.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ENROLLMENT_COUNT_STATUSES,
  ENROLLMENT_STATUS_LABEL_AR,
  ENROLLMENT_TRUST_WARNING_AR,
  normalizeEnrollmentCountStatus,
  type EnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";
import {
  saveEnrollmentOwnership,
  validateEnrollmentOwnershipDraft,
} from "@/lib/schedule-builder/enrollment-ownership";

export type EnrollmentEditTarget = {
  courseOfferingId: string;
  collegeId: string;
  courseLabel: string;
  sectionLabel: string;
  studySystemLabel: string;
  enrollmentCount: number | null;
  enrollmentCountStatus: EnrollmentCountStatus;
  enrollmentCountUpdatedAt: string | null;
};

export function EnrollmentEditDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: EnrollmentEditTarget | null;
  onSaved: (next: {
    enrollmentCount: number;
    enrollmentCountStatus: EnrollmentCountStatus;
    enrollmentCountUpdatedAt: string;
  }) => void;
}) {
  const [countText, setCountText] = useState("");
  const [status, setStatus] = useState<EnrollmentCountStatus>("unverified");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setCountText(target.enrollmentCount != null ? String(target.enrollmentCount) : "");
    setStatus(normalizeEnrollmentCountStatus(target.enrollmentCountStatus));
    setConfirmOpen(false);
    setSaving(false);
    setError(null);
  }, [open, target]);

  const draft = useMemo(() => {
    const trimmed = countText.trim();
    const enrollmentCount = trimmed === "" ? null : Number(trimmed);
    return {
      enrollmentCount:
        enrollmentCount != null && Number.isFinite(enrollmentCount) ? enrollmentCount : null,
      enrollmentCountStatus: status,
    };
  }, [countText, status]);

  const validation = validateEnrollmentOwnershipDraft(draft);

  async function performSave() {
    if (!target || !validation.ok) return;
    setSaving(true);
    setError(null);
    const result = await saveEnrollmentOwnership({
      collegeId: target.collegeId,
      courseOfferingId: target.courseOfferingId,
      draft,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.reasonAr);
      return;
    }
    onSaved({
      enrollmentCount: validation.count,
      enrollmentCountStatus: validation.status,
      enrollmentCountUpdatedAt: result.updatedAt,
    });
    setConfirmOpen(false);
    onOpenChange(false);
  }

  function onSaveClick() {
    if (!validation.ok) {
      setError(validation.reasonAr);
      return;
    }
    setError(null);
    if (status === "confirmed") {
      setConfirmOpen(true);
      return;
    }
    void performSave();
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          onOpenChange(next);
        }}
      >
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل عدد الطلاب</DialogTitle>
            <DialogDescription>
              الحفظ يتم فقط عند الضغط على «حفظ واعتماد». لا يؤثر على تعديلات الجلسة المحلية غير
              المحفوظة.
            </DialogDescription>
          </DialogHeader>

          {target ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border p-3 space-y-1 bg-muted/30">
                <p>
                  <span className="text-muted-foreground">المقرر: </span>
                  {target.courseLabel}
                </p>
                <p>
                  <span className="text-muted-foreground">مجموعة المحاضرة أو المعمل: </span>
                  {target.sectionLabel}
                </p>
                <p>
                  <span className="text-muted-foreground">النظام الدراسي: </span>
                  {target.studySystemLabel}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="enrollment-count">عدد الطلاب</Label>
                <Input
                  id="enrollment-count"
                  type="number"
                  min={0}
                  step={1}
                  value={countText}
                  onChange={(e) => setCountText(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <Label>حالة الموثوقية</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(normalizeEnrollmentCountStatus(v))}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENROLLMENT_COUNT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {ENROLLMENT_STATUS_LABEL_AR[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ENROLLMENT_TRUST_WARNING_AR[status]}
                </p>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              إلغاء
            </Button>
            <Button type="button" disabled={saving || !target} onClick={onSaveClick}>
              {saving ? "جاري الحفظ…" : "حفظ واعتماد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>تأكيد اعتماد العدد</DialogTitle>
            <DialogDescription>
              اعتماد العدد كـ«مؤكد» قد يفعّل فحص السعة الإلزامي (+5) ويعرض اقتراح تقسيم أو يمنع قاعة
              غير مناسبة. هل تريد المتابعة؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmOpen(false)}
            >
              رجوع
            </Button>
            <Button type="button" disabled={saving} onClick={() => void performSave()}>
              {saving ? "جاري الحفظ…" : "تأكيد الحفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
