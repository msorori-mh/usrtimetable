import { useState } from "react";
import { Card } from "@/components/ui/card";
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
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { userErrorMessage } from "@/lib/user-error";
import { formatNumber } from "@/lib/format";
import { updateByIdChunks, fetchAll } from "@/components/data-cleanup/cleanup-data";
import { Diagnostics } from "@/components/data-cleanup/cleanup-diagnostics";
import { IssueRow, offeringItems, BulkDialog } from "@/components/data-cleanup/cleanup-shared";

/** Course offerings cleanup section. */
// ---------- OFFERINGS ----------
export function OfferingsSection({
  data,
  diag,
  canManage,
  onChanged,
  collegeId,
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
  const offItems = (ids: string[] | undefined, reason: string) => offeringItems(data, ids, reason);

  return (
    <Card className="space-y-3 p-4">
      <IssueRow
        issue={issues?.off_zero_students}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("students")}>
              تحديث expected_students
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.off_no_assignment} />
      <IssueRow
        issue={issues?.off_no_system}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("system")}>
              تعيين نظام الدراسة
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.off_no_plan_course} />

      <BulkDialog
        open={dlg === "students"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للطلاب المتوقعين"
        items={offItems(issues?.off_zero_students.ids, "عدد الطلاب 0")}
        onConfirm={async (ids) => {
          if (!Number.isFinite(students) || students <= 0) {
            toast.error("قيمة غير صحيحة");
            return false;
          }
          const { error } = await updateByIdChunks(
            "course_offerings",
            { expected_students: students },
            ids,
          );
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "course_offerings",
            collegeId,
            details: { kind: "expected_students", value: students, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} طرح`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f4">عدد الطلاب المتوقع</Label>
          <Input
            id="cleanup-f4"
            type="number"
            min={1}
            value={students}
            onChange={(e) => setStudents(Number(e.target.value))}
          />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "system"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نظام الدراسة"
        items={offItems(issues?.off_no_system.ids, "بدون نظام دراسة")}
        onConfirm={async (ids) => {
          const { error } = await updateByIdChunks(
            "course_offerings",
            { study_system: system },
            ids,
          );
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "course_offerings",
            collegeId,
            details: { kind: "study_system", value: system, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} طرح`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f11">النظام</Label>
          <Select value={system} onValueChange={(v) => setSystem(v as typeof system)}>
            <SelectTrigger id="cleanup-f11">
              <SelectValue />
            </SelectTrigger>
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
