import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { userErrorMessage } from "@/lib/user-error";
import { formatNumber } from "@/lib/format";
import { updateByIdChunks, fetchAll } from "@/components/data-cleanup/cleanup-data";
import { Diagnostics } from "@/components/data-cleanup/cleanup-diagnostics";
import { IssueRow, courseItems, planCourseItems, BulkDialog } from "@/components/data-cleanup/cleanup-shared";

/** Courses cleanup section. */
// ---------- COURSES ----------
export function CoursesSection({
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
  const [dlg, setDlg] = useState<null | "temp_codes" | "nature" | "room_req">(null);
  const issues = diag?.issues;

  // dialog state
  const [codePrefix, setCodePrefix] = useState("");
  const [natureVal, setNatureVal] = useState<"department" | "college" | "university">("department");
  const [lectureRoom, setLectureRoom] = useState("lecture_hall");
  const [labRoom, setLabRoom] = useState("computer_lab");

  const tempItems = useMemo(
    () => courseItems(data, issues?.temp_codes.ids, "رمز مؤقت CRS-"),
    [data, issues],
  );
  const natureItems = useMemo(
    () => courseItems(data, issues?.course_missing_nature.ids, "طبيعة المقرر غير محددة"),
    [data, issues],
  );
  const roomReqItems = useMemo(
    () => planCourseItems(data, issues?.course_no_room_req.ids),
    [data, issues],
  );

  return (
    <Card className="space-y-3 p-4">
      <IssueRow
        issue={issues?.temp_codes}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("temp_codes")}>
              تحديث جماعي للرموز
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.course_no_plan} />
      <IssueRow
        issue={issues?.course_missing_nature}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("nature")}>
              تعيين طبيعة المقرر
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.course_no_pattern} />
      <IssueRow
        issue={issues?.course_no_room_req}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("room_req")}>
              تعيين متطلبات القاعة
            </Button>
          ) : null
        }
      />

      <BulkDialog
        open={dlg === "temp_codes"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للرموز المؤقتة (CRS-)"
        description="سيُستبدل بادئة CRS- بالبادئة الجديدة مع الحفاظ على الجزء الرقمي."
        items={tempItems}
        confirmLabel="تطبيق التحديث"
        onConfirm={async (ids) => {
          if (!codePrefix.trim()) {
            toast.error("أدخل البادئة الجديدة");
            return false;
          }
          const rows = (data?.courses ?? []).filter((c) => ids.includes(c.id));
          const updates = await Promise.all(
            rows.map(async (c) => {
              const newCode = c.code.replace(/^CRS-/i, `${codePrefix.trim()}-`);
              const { error } = await supabase
                .from("courses")
                .update({ code: newCode })
                .eq("id", c.id);
              return { id: c.id, error };
            }),
          );
          const failed = updates.filter((u) => u.error).length;
          await logAudit({
            action: "bulk_update",
            entity: "courses",
            collegeId,
            details: { kind: "code_prefix_rename", count: ids.length, prefix: codePrefix, failed },
          });
          onChanged();
          if (failed) {
            toast.error(`تم التحديث مع فشل ${formatNumber(failed)} عنصر؛ راجع العناصر المتبقية`);
            return false;
          }
          toast.success(`تم تحديث رموز ${formatNumber(ids.length)} مقرر`);
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f1">البادئة الجديدة (بدون شرطة)</Label>
          <Input id="cleanup-f1"
            value={codePrefix}
            onChange={(e) => setCodePrefix(e.target.value)}
            placeholder="مثال: CS, IT, CYS"
          />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "nature"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين طبيعة المقرر"
        items={natureItems}
        onConfirm={async (ids) => {
          const { error } = await updateByIdChunks("courses", { course_nature: natureVal }, ids);
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "courses",
            collegeId,
            details: { kind: "course_nature", value: natureVal, count: ids.length },
          });
          toast.success(`تم تعيين الطبيعة لـ ${formatNumber(ids.length)} مقرر`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f5">الطبيعة</Label>
          <Select value={natureVal} onValueChange={(v) => setNatureVal(v as typeof natureVal)}>
            <SelectTrigger id="cleanup-f5">
              <SelectValue />
            </SelectTrigger>
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
        description="يُطبَّق فقط حيث القيمة فارغة، ووفقاً لوجود محاضرات/معامل."
        items={roomReqItems}
        onConfirm={async (ids) => {
          const rows = (data?.planCourses ?? []).filter((p) => ids.includes(p.id));
          let ok = 0,
            fail = 0;
          for (const r of rows) {
            const upd: {
              required_room_type_for_lecture?: string;
              required_room_type_for_lab?: string;
            } = {};
            if ((r.lectures_per_week ?? 0) > 0 && !r.required_room_type_for_lecture)
              upd.required_room_type_for_lecture = lectureRoom;
            if ((r.labs_per_week ?? 0) > 0 && !r.required_room_type_for_lab)
              upd.required_room_type_for_lab = labRoom;
            if (Object.keys(upd).length === 0) continue;
            const { error } = await supabase.from("plan_courses").update(upd).eq("id", r.id);
            if (error) fail++;
            else ok++;
          }
          await logAudit({
            action: "bulk_update",
            entity: "plan_courses",
            collegeId,
            details: { kind: "room_requirements", lecture: lectureRoom, lab: labRoom, ok, fail },
          });
          onChanged();
          if (fail) {
            toast.error(
              `تم تحديث ${formatNumber(ok)} مقرر خطة وفشل ${formatNumber(fail)}؛ راجع العناصر المتبقية`,
            );
            return false;
          }
          toast.success(`تم تحديث ${ok} مقرر خطة`);
          return true;
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="cleanup-f6">قاعة المحاضرة</Label>
            <Select value={lectureRoom} onValueChange={setLectureRoom}>
              <SelectTrigger id="cleanup-f6">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lecture_hall">قاعة محاضرات</SelectItem>
                <SelectItem value="seminar_room">قاعة ندوات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cleanup-f7">قاعة المعمل</Label>
            <Select value={labRoom} onValueChange={setLabRoom}>
              <SelectTrigger id="cleanup-f7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="computer_lab">معمل حاسوب</SelectItem>
                <SelectItem value="network_lab">معمل شبكات</SelectItem>
                <SelectItem value="cybersecurity_lab">معمل أمن سيبراني</SelectItem>
                <SelectItem value="electronics_lab">معمل إلكترونيات</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </BulkDialog>
    </Card>
  );
}
