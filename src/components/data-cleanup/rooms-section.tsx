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
import { IssueRow, roomBulkItems, BulkDialog } from "@/components/data-cleanup/cleanup-shared";

/** Rooms cleanup section. */
// ---------- ROOMS ----------
export function RoomsSection({
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
  const [dlg, setDlg] = useState<null | "cap" | "type">(null);
  const [cap, setCap] = useState<number>(40);
  const [roomTypeId, setRoomTypeId] = useState<string>("");
  const roomItems = (ids: string[] | undefined, reason: string) => roomBulkItems(data, ids, reason);

  return (
    <Card className="space-y-3 p-4">
      <IssueRow
        issue={issues?.room_default_cap}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("cap")}>
              تحديث السعة
            </Button>
          ) : null
        }
      />
      <IssueRow
        issue={issues?.room_no_type}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setDlg("type")}>
              تعيين نوع القاعة
            </Button>
          ) : null
        }
      />
      <IssueRow issue={issues?.room_dup_name} />
      <IssueRow issue={issues?.room_inactive} />

      <BulkDialog
        open={dlg === "cap"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تحديث جماعي للسعة"
        items={roomItems(issues?.room_default_cap.ids, "سعة افتراضية 30")}
        onConfirm={async (ids) => {
          if (!Number.isFinite(cap) || cap <= 0) {
            toast.error("سعة غير صحيحة");
            return false;
          }
          const { error } = await updateByIdChunks("rooms", { capacity: cap }, ids);
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "rooms",
            collegeId,
            details: { kind: "capacity", value: cap, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} قاعة`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f3">السعة الجديدة</Label>
          <Input
            id="cleanup-f3"
            type="number"
            min={1}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
          />
        </div>
      </BulkDialog>

      <BulkDialog
        open={dlg === "type"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="تعيين نوع القاعة"
        items={roomItems(issues?.room_no_type.ids, "بدون نوع")}
        onConfirm={async (ids) => {
          if (!roomTypeId) {
            toast.error("اختر النوع");
            return false;
          }
          const rt = (data?.roomTypes ?? []).find((t) => t.id === roomTypeId);
          const upd: { room_type_id: string; room_type?: string } = { room_type_id: roomTypeId };
          // also sync legacy text column if code maps to allowed enum
          if (
            rt?.code &&
            [
              "lecture_hall",
              "computer_lab",
              "network_lab",
              "cybersecurity_lab",
              "electronics_lab",
              "workshop",
              "seminar_room",
            ].includes(rt.code)
          ) {
            upd.room_type = rt.code;
          }
          const { error } = await updateByIdChunks("rooms", upd, ids);
          if (error) {
            toast.error(userErrorMessage(error));
            return false;
          }
          await logAudit({
            action: "bulk_update",
            entity: "rooms",
            collegeId,
            details: { kind: "room_type", value: roomTypeId, count: ids.length },
          });
          toast.success(`تم التحديث لـ ${formatNumber(ids.length)} قاعة`);
          onChanged();
          return true;
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cleanup-f10">النوع</Label>
          <Select value={roomTypeId} onValueChange={setRoomTypeId}>
            <SelectTrigger id="cleanup-f10">
              <SelectValue placeholder="اختر النوع..." />
            </SelectTrigger>
            <SelectContent>
              {(data?.roomTypes ?? []).map((t) => (
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
