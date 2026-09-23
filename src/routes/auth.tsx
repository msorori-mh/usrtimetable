import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import {
  USR_AUTH_NOTICE_AR,
  USR_PLATFORM_DESC_AR,
  USR_PLATFORM_NAME_AR,
  USR_UNIVERSITY_NAME_AR,
} from "@/lib/branding/usr";
import { toast } from "sonner";
import { checkCurrentSession } from "@/lib/auth/session-service";
import { boundedSessionRequest, SessionCheckError } from "@/lib/auth/check-session";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: `تسجيل الدخول — ${USR_PLATFORM_NAME_AR}` }] }),
  component: AuthPage,
});

/** Fail closed when the MFA service is unavailable or its factor response is incomplete. */
async function pendingSecondFactor(signal: AbortSignal): Promise<string | null> {
  const { data: level, error: levelError } = await boundedSessionRequest(
    () => supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    "التحقق بخطوتين",
    signal,
  );
  if (levelError || !level)
    throw new SessionCheckError("تعذّر التحقق من المصادقة بخطوتين. أعد المحاولة.");
  if (level.currentLevel === "aal2" || level.nextLevel !== "aal2") return null;
  const { data: list, error: listError } = await boundedSessionRequest(
    () => supabase.auth.mfa.listFactors(),
    "تحميل وسيلة التحقق بخطوتين",
    signal,
  );
  if (listError || !list)
    throw new SessionCheckError("تعذّر تحميل وسيلة التحقق بخطوتين. أعد المحاولة.");
  const factor = list.totp?.find((f) => f.status === "verified");
  if (!factor) throw new SessionCheckError("وسيلة التحقق بخطوتين غير متاحة. تواصل مع المشرف.");
  return factor.id;
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Second factor step: only rendered when the signed-in account has a verified
  // TOTP factor and the fresh session is still aal1.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  const finishSignIn = useCallback(
    async (signal: AbortSignal) => {
      const result = await checkCurrentSession(signal);
      if (signal.aborted || result.kind === "signed-out") return;
      const factorId = await pendingSecondFactor(signal);
      if (signal.aborted) return;
      if (factorId) {
        setMfaFactorId(factorId);
        setOtp("");
        return;
      }
      if (result.mfaRequired)
        throw new SessionCheckError("يلزم إعداد التحقق بخطوتين للحساب؛ تواصل مع المشرف.");
      void navigate({ to: "/dashboard", replace: true });
    },
    [navigate],
  );

  // A saved aal1 session must resume MFA, not silently enter an empty dashboard.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void finishSignIn(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          toast.error(
            error instanceof SessionCheckError
              ? error.message
              : "تعذّر التحقق من الجلسة. أعد المحاولة.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [finishSignIn]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await finishSignIn(new AbortController().signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      toast.error(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId) return;
    setLoading(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: ch.id,
        code: otp.trim(),
      });
      if (vErr) throw vErr;
      toast.success("مرحباً بك");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      toast.error(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2 bg-[var(--usr-bg)]">
      <div className="hidden lg:flex lg:flex-col">
        <div className="usr-gold-rule shrink-0" />
        <div className="flex flex-1 flex-col justify-between bg-[image:var(--gradient-hero)] p-12 text-primary-foreground">
          <div className="flex items-center gap-4">
            <UsrBrandMark size="xl" variant="onPrimary" className="rounded-xl" />
            <div>
              <p className="text-xl font-bold">{USR_UNIVERSITY_NAME_AR}</p>
              <p className="text-sm text-white/85">{USR_PLATFORM_NAME_AR}</p>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold leading-tight border-r-4 border-[var(--usr-gold)] pr-4">
              {USR_PLATFORM_NAME_AR}
            </h2>
            <p className="mt-4 max-w-md text-white/90 leading-relaxed">{USR_PLATFORM_DESC_AR}</p>
            <p className="usr-access-notice usr-access-notice--on-dark mt-5 max-w-md text-right">
              {USR_AUTH_NOTICE_AR}
            </p>
          </div>
          <p className="text-xs text-white/55">{USR_UNIVERSITY_NAME_AR}</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md overflow-hidden rounded-xl border border-border shadow-[var(--shadow-card)]">
          <div className="usr-auth-header lg:hidden">
            <div className="flex items-center gap-3">
              <UsrBrandMark size="md" variant="onPrimary" />
              <div>
                <p className="font-bold">{USR_UNIVERSITY_NAME_AR}</p>
                <p className="text-xs text-white/80">{USR_PLATFORM_NAME_AR}</p>
              </div>
            </div>
          </div>

          <div className="usr-auth-card rounded-none border-0 shadow-none">
            <h1 className="mb-2 text-2xl font-bold text-[var(--usr-primary-dark)]">تسجيل الدخول</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              أدخل بيانات حسابك المصرّح به للوصول إلى المنصّة.
            </p>

            <div className="usr-access-notice mb-6 text-right">{USR_AUTH_NOTICE_AR}</div>

            {mfaFactorId ? (
              <form onSubmit={handleOtp} className="space-y-4" data-testid="auth-mfa-step">
                <div className="space-y-2">
                  <Label htmlFor="otp">رمز التحقق من تطبيق المصادقة</Label>
                  <Input
                    id="otp"
                    required
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full rounded-lg" size="lg" disabled={loading}>
                  {loading ? "جارٍ التحقق..." : "تأكيد الرمز"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handle} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">البريد الإلكتروني</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@university.edu"
                    dir="ltr"
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <PasswordInput
                    id="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    dir="ltr"
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full rounded-lg" size="lg" disabled={loading}>
                  {loading ? "جارٍ التحقق..." : "تسجيل الدخول"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function translateAuthError(msg: string): string {
  if (msg.includes("Invalid login")) return "بيانات الدخول غير صحيحة أو الحساب غير مخوّل";
  if (msg.includes("Password should")) return "كلمة المرور لا تستوفي متطلبات الحساب.";
  return msg;
}
