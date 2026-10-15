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
  /** L-1: always null — recovery links are e-mailed, never returned to the browser. */
  action_link: string | null;
  /** True when Supabase e-mailed a recovery link directly to the account owner. */
  sent?: boolean;
}

export const RECOVERY_EMAIL_SENT_AR = "أُرسل رابط الاستعادة إلى بريد المستخدم";

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
      if (!response.temporary_password && response.sent !== true)
        throw new Error("لم تصل بيانات الاستعادة؛ أعد المحاولة.");
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إعادة التعيين.");
    } finally {
      setBusy(false);
    }
  };
  // Only a temporary password is ever displayed; a recovery link never is.
  const credential = result?.temporary_password ?? "";
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
          <DialogTitle>
            {result?.temporary_password
              ? "بيانات الدخول الجديدة"
              : result
                ? "تم إرسال رابط الاستعادة"
                : "إعادة تعيين كلمة المرور"}
          </DialogTitle>
          <DialogDescription>
            {target.name} — <span dir="ltr">{result?.email ?? target.email}</span>
          </DialogDescription>
        </DialogHeader>
        {result?.temporary_password ? (
          <div className="space-y-3">
            <Label htmlFor="admin-reset-credential">كلمة المرور المؤقتة الجديدة</Label>
            <Input
              id="admin-reset-credential"
              dir="ltr"
              readOnly
              autoComplete="off"
              value={credential}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="text-sm text-muted-foreground">
              تم تعيين هذه الكلمة بنجاح. انسخها وأرسلها للمستخدم؛ سيُطلب منه تغييرها عند الدخول. لم
              تُرسل رسالة تلقائيًا. تُزال هذه البيانات من النافذة عند إغلاقها.
            </p>
            <Button type="button" onClick={() => void copy()}>
              نسخ
            </Button>
            <p role="status" className="text-sm">
              {copyStatus}
            </p>
          </div>
        ) : result ? (
          <div className="space-y-2" data-testid="recovery-email-sent">
            <p role="status" className="text-sm font-medium">
              {RECOVERY_EMAIL_SENT_AR}
            </p>
            <p className="text-sm text-muted-foreground">
              حساب مدير النظام يعيّن كلمته بنفسه عبر الرابط المرسل إلى بريده؛ لا يُعرض الرابط هنا.
            </p>
          </div>
        ) : (
          <p className="text-sm">
            سيتم استبدال كلمة مرور هذا المستخدم بكلمة مؤقتة وعرضها هنا لإرسالها إليه. حسابات مدير
            النظام يُرسل إليها رابط الاستعادة بالبريد مباشرة.
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
