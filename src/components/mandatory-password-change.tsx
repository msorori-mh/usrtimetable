import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { completeInitialPasswordChange } from "@/lib/password-change.functions";
import { PASSWORD_POLICY_AR, validPersonalPassword } from "@/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MandatoryPasswordChange({ onComplete }: { onComplete: () => void }) {
  const changePassword = useServerFn(completeInitialPasswordChange);
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-md space-y-5 rounded-xl border bg-card p-6 shadow-sm"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (!validPersonalPassword(newPassword)) {
            setError(PASSWORD_POLICY_AR);
            return;
          }
          if (newPassword !== confirmation) {
            setError("كلمتا المرور الجديدتان غير متطابقتين.");
            return;
          }
          if (newPassword === currentPassword) {
            setError("اختر كلمة مرور مختلفة عن المؤقتة.");
            return;
          }
          setBusy(true);
          try {
            await changePassword({ data: { currentPassword, newPassword } });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmation("");
            queryClient.clear();
            await supabase.auth.refreshSession();
            onComplete();
          } catch (e) {
            setError(e instanceof Error ? e.message : "تعذر تغيير كلمة المرور. أعد المحاولة.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-2xl font-bold">عيّن كلمة مرور خاصة بك</h1>
        <p className="text-sm text-muted-foreground">
          يجب تغيير كلمة المرور المؤقتة قبل استخدام المنصة.
        </p>
        <div className="space-y-2">
          <Label htmlFor="temporary-password">كلمة المرور المؤقتة</Label>
          <Input
            id="temporary-password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            disabled={busy}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="personal-password">كلمة المرور الجديدة</Label>
          <Input
            id="personal-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            disabled={busy}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">{PASSWORD_POLICY_AR}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">تأكيد كلمة المرور الجديدة</Label>
          <Input
            id="confirm-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            disabled={busy}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور والمتابعة"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void supabase.auth.signOut()}
        >
          تسجيل الخروج
        </Button>
      </form>
    </main>
  );
}
