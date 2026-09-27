import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export interface AdminResetResult {
  email: string;
  temporary_password: string | null;
  action_link: string | null;
}

export function PasswordResetDialog({
  target,
  onReset,
  onClose,
}: {
  target: { id: string; email: string; name: string };
  onReset: () => Promise<AdminResetResult>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<AdminResetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await onReset();
      if (!response.temporary_password && !response.action_link)
        throw new Error("لم تصل بيانات الاستعادة؛ أعد المحاولة.");
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إعادة التعيين.");
    } finally {
      setBusy(false);
    }
  };
  const credential = result?.temporary_password ?? result?.action_link ?? "";
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(credential);
      setCopyStatus("تم النسخ.");
    } catch {
      setCopyStatus("تعذر النسخ التلقائي؛ حدد النص وانسخه يدويًا.");
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{result ? "بيانات الدخول الجديدة" : "إعادة تعيين كلمة المرور"}</DialogTitle>
          <DialogDescription>
            {target.name} — <span dir="ltr">{result?.email ?? target.email}</span>
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <Label htmlFor="admin-reset-credential">
              {result.temporary_password
                ? "كلمة المرور المؤقتة الجديدة"
                : "رابط استعادة حساب الأدمن"}
            </Label>
            <Input
              id="admin-reset-credential"
              dir="ltr"
              readOnly
              autoComplete="off"
              value={credential}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="text-sm text-muted-foreground">
              {result.temporary_password
                ? "تم تعيين هذه الكلمة بنجاح. انسخها وأرسلها للمستخدم؛ سيُطلب منه تغييرها عند الدخول."
                : "حساب الأدمن يستخدم رابط الاستعادة لتعيين كلمته بنفسه. انسخ الرابط وأرسله لصاحب الحساب."}{" "}
              لم تُرسل رسالة تلقائيًا. تُزال هذه البيانات من النافذة عند إغلاقها.
            </p>
            <Button type="button" onClick={() => void copy()}>
              نسخ
            </Button>
            <p role="status" className="text-sm">
              {copyStatus}
            </p>
          </div>
        ) : (
          <p className="text-sm">
            سيتم استبدال كلمة مرور هذا المستخدم بكلمة مؤقتة وعرضها هنا لإرسالها إليه. حسابات الأدمن
            تستخدم رابط الاستعادة.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {result ? "إغلاق" : "إلغاء"}
          </Button>
          {!result && (
            <Button disabled={busy} onClick={() => void reset()}>
              {busy ? "جارٍ إعادة التعيين…" : "تأكيد إعادة التعيين"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
