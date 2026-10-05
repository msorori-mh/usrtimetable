import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import { USR_PLATFORM_NAME_AR, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { PASSWORD_POLICY_AR, validPersonalPassword } from "@/lib/password-policy";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: `استعادة كلمة المرور — ${USR_PLATFORM_NAME_AR}` }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  // The recovery link lands here with type=recovery in the URL hash; the
  // Supabase client exchanges it for a recovery session automatically.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    const timer = window.setTimeout(() => setInvalid(true), 8000);
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validPersonalPassword(password)) {
      toast.error(PASSWORD_POLICY_AR);
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين.");
      return;
    }
    setLoading(true);
    try {
      // Recovery session: never send current_password here.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("تم تحديث كلمة المرور بنجاح. سجّل الدخول بكلمة المرور الجديدة.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      toast.error(msg.includes("Password should") ? PASSWORD_POLICY_AR : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--usr-bg)] p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border shadow-[var(--shadow-card)]">
        <div className="usr-auth-header">
          <div className="flex items-center gap-3">
            <UsrBrandMark size="md" variant="onPrimary" />
            <div>
              <p className="font-bold">{USR_UNIVERSITY_NAME_AR}</p>
              <p className="text-xs text-white/80">{USR_PLATFORM_NAME_AR}</p>
            </div>
          </div>
        </div>

        <div className="usr-auth-card rounded-none border-0 shadow-none">
          <h1 className="mb-2 text-2xl font-bold text-[var(--usr-primary-dark)]">
            تعيين كلمة مرور جديدة
          </h1>

          {invalid && !ready ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                رابط الاستعادة غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا من صفحة تسجيل
                الدخول.
              </p>
              <Button asChild className="w-full rounded-lg" size="lg">
                <Link to="/auth">العودة لتسجيل الدخول</Link>
              </Button>
            </div>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">جارٍ التحقق من رابط الاستعادة...</p>
          ) : (
            <form onSubmit={handle} className="space-y-4" data-testid="reset-password-form">
              <p className="text-sm text-muted-foreground">{PASSWORD_POLICY_AR}</p>
              <div className="space-y-2">
                <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
                <PasswordInput
                  id="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label>
                <PasswordInput
                  id="confirm-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  dir="ltr"
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full rounded-lg" size="lg" disabled={loading}>
                {loading ? "جارٍ الحفظ..." : "حفظ كلمة المرور الجديدة"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
