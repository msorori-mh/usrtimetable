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
import { IssueRow, instructorItems, BulkDialog } from "@/components/data-cleanup/cleanup-shared";

/** Instructors cleanup section. */
// ---------- INSTRUCTORS ----------
export function InstructorsSection({
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
  const [dlg, setDlg] = useState<null | "dept" | "spec" | "type">(null);
  const [deptId, setDeptId] = useState<string>("");
  const [spec, setSpec] = useState("");
  const [typeId, setTypeId] = useState<string>("");
  const insItems = (ids: string[] | undefined, reason: string) =>
    instructorItems(data, ids, reason);

  return (
    <Card className="space-y-3 p-4">
      <IssueRow
        issue={issues?.ins_no_spec}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("spec")}>
              تعيين التخصص
            </Button>
          ) : null
        }
      />
      <IssueRow
        issue={issues?.ins_no_dept}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("dept")}>
              تعيين القسم
            </Button>
          ) : null
        }
      />
      <IssueRow
        issue={issues?.ins_no_type}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("type")}>
              تعيين النوع
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.ins_no_avail} />

      <BulkDialog
        open={dlg === "dept"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين القسم للمحاضرين"
        items={insItems(issues?.ins_no_dept.ids, "بدون قسم")}
        onConfirm={async (ids) => {
          if (!deptId) {
            toast.error("اختر قسماً");
            return false;
          }
          const { error } = await updateByIdChunks("instructors", { department_id: deptId }, ids);
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "instructors",
            collegeId,
            details: { kind: "department", value: deptId, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} محاضر`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f8">القسم</Label>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger id="cleanup-f8">
              <SelectValue placeholder="اختر قسماً..." />
            </SelectTrigger>
            <SelectContent>
              {(data?.departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "spec"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين التخصص للمحاضرين"
        items={insItems(issues?.ins_no_spec.ids, "بدون تخصص")}
        onConfirm={async (ids) => {
          if (!spec.trim()) {
            toast.error("أدخل التخصص");
            return false;
          }
          const { error } = await updateByIdChunks(
            "instructors",
            { specialization: spec.trim() },
            ids,
          );
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "instructors",
            collegeId,
            details: { kind: "specialization", value: spec.trim(), count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} محاضر`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f2">التخصص</Label>
          <Input
            id="cleanup-f2"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="مثال: علوم الحاسب"
          />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "type"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نوع المحاضر"
        items={insItems(issues?.ins_no_type.ids, "بدون نوع")}
        onConfirm={async (ids) => {
          if (!typeId) {
            toast.error("اختر النوع");
            return false;
          }
          const { error } = await updateByIdChunks(
            "instructors",
            { instructor_type_id: typeId },
            ids,
          );
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "instructors",
            collegeId,
            details: { kind: "instructor_type", value: typeId, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} محاضر`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f9">النوع</Label>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger id="cleanup-f9">
              <SelectValue placeholder="اختر النوع..." />
            </SelectTrigger>
            <SelectContent>
              {(data?.instructorTypes ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BulkDialog>
    </Card>
  );
}
