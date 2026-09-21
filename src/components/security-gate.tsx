import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SecurityGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ready" | "mfa" | "error">("checking");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    const result = await supabase.rpc("security_access_status" as never);
    const status = result.data as { session_valid?: boolean; mfa_required?: boolean } | null;
    if (result.error || !status?.session_valid)
      throw new Error("تعذر التحقق من الجلسة. أعد المحاولة أو سجّل الدخول مجددًا.");
    if (!status.mfa_required) {
      setState("ready");
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw new Error("تعذر قراءة إعدادات التحقق بخطوتين.");
    setFactorId(factors.data.totp.find((f) => f.status === "verified")?.id ?? "");
    setState("mfa");
  };
  useEffect(() => {
    let active = true;
    void check().catch((e) => {
      if (active) {
        setError(e.message);
        setState("error");
      }
    });
    // Recheck on a refreshed token so removing MFA or losing assurance cannot
    // leave protected content displayed. Database policies remain authoritative.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "MFA_CHALLENGE_VERIFIED") {
        setState("checking");
        setTimeout(() => {
          if (active)
            void check().catch((e) => {
              setError(e.message);
              setState("error");
            });
        }, 0);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (state === "ready") return <>{children}</>;
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-bold">حماية حساب الإدارة</h1>
        {state === "checking" && <p>جارٍ التحقق من حماية الحساب…</p>}
        {state === "mfa" && (
          <>
            <p>
              يلزم التحقق بخطوتين للوصول إلى حساب الإدارة. احتفظ بنسخة احتياطية آمنة من تطبيق
              التحقق.
            </p>
            {!factorId && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const factors = await supabase.auth.mfa.listFactors();
                    if (factors.error) throw factors.error;
                    for (const f of factors.data.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
                      const removed = await supabase.auth.mfa.unenroll({ factorId: f.id });
                      if (removed.error) throw removed.error;
                    }
                    const enrolled = await supabase.auth.mfa.enroll({
                      factorType: "totp",
                      friendlyName: "تطبيق التحقق الجامعي",
                    });
                    if (enrolled.error) throw enrolled.error;
                    setFactorId(enrolled.data.id);
                    setQr(enrolled.data.totp.qr_code);
                  } catch {
                    setError("تعذر بدء الربط. أعد المحاولة.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ربط تطبيق التحقق
              </Button>
            )}
            {qr && (
              <>
                <p>امسح الرمز بتطبيق التحقق الخاص بك. لا تشارك هذه الصورة أو الرمز مع أي شخص.</p>
                <img
                  className="mx-auto h-56 w-56"
                  src={qr}
                  alt="رمز ربط تطبيق التحقق الخاص بحسابك"
                />
              </>
            )}
            {factorId && (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
                    if (verified.error) throw verified.error;
                    setQr("");
                    setCode("");
                    await check();
                  } catch {
                    setError("تعذر التحقق. تأكد من الرمز الحالي ثم أعد المحاولة.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label htmlFor="mfa-code">رمز تطبيق التحقق</label>
                <Input
                  id="mfa-code"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  disabled={busy}
                />
                <Button type="submit" disabled={busy}>
                  تحقق ومتابعة
                </Button>
              </form>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {state === "error" && (
          <Button
            onClick={() => {
              setState("checking");
              void check().catch((e) => {
                setError(e.message);
                setState("error");
              });
            }}
          >
            إعادة المحاولة
          </Button>
        )}
        <Button variant="outline" onClick={() => void supabase.auth.signOut()}>
          تسجيل الخروج
        </Button>
      </div>
    </main>
  );
}
