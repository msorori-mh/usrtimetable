/**
 * SECURITY-HARDENING-01 — owner-driven MFA (TOTP) enrollment for admin accounts.
 *
 * Nothing is enrolled automatically: the QR/secret is requested only after the
 * signed-in owner clicks "بدء التسجيل", and the factor becomes `verified` only
 * after the owner types a valid code from the authenticator app. The current
 * session is never terminated by this page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/account-security")({
  head: () => ({
    meta: [
      { title: "أمان الحساب — التحقق بخطوتين" },
      {
        name: "description",
        content: "تسجيل تطبيق المصادقة (TOTP) للحسابات الإدارية وإدارة عوامل التحقق.",
      },
      { property: "og:title", content: "أمان الحساب — التحقق بخطوتين" },
      {
        property: "og:description",
        content: "تسجيل تطبيق المصادقة (TOTP) للحسابات الإدارية وإدارة عوامل التحقق.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountSecurityPage,
});

type Factor = { id: string; friendly_name?: string | null; status: string };

function AccountSecurityPage() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [aal, setAal] = useState<{ current: string | null; next: string | null }>({
    current: null,
    next: null,
  });
  const [pending, setPending] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [{ data: list, error: listErr }, { data: level }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (listErr) {
      setError(listErr.message);
      return;
    }
    setError(null);
    setFactors(((list?.all ?? []) as Factor[]).filter((f) => f.status !== "unverified" || true));
    setAal({ current: level?.currentLevel ?? null, next: level?.nextLevel ?? null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `authenticator-${new Date().toISOString().slice(0, 10)}`,
      });
      if (err) throw err;
      setPending({
        id: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر بدء التسجيل");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const confirmEnroll = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: pending.id,
      });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: pending.id,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      toast.success("تم تنشيط التحقق بخطوتين لهذا الحساب");
      setPending(null);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "رمز غير صحيح");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (err) throw err;
      toast.success("تم إلغاء العامل");
      if (pending?.id === id) setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الإلغاء");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4" dir="rtl" data-testid="account-security-page">
      <div>
        <h1 className="text-2xl font-bold">أمان الحساب</h1>
        <p className="text-sm text-muted-foreground">
          فعّل التحقق بخطوتين عبر تطبيق مصادقة (Google Authenticator، Microsoft Authenticator،
          Authy…). لا يتم تسجيل أي عامل إلا بضغطك أنت وبإدخال رمز صحيح من تطبيقك.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">الحالة الحالية</CardTitle>
          <CardDescription>
            مستوى الجلسة الحالي:{" "}
            <span dir="ltr" data-testid="account-security-aal">
              {aal.current ?? "—"}
            </span>{" "}
            / المطلوب:{" "}
            <span dir="ltr" data-testid="account-security-aal-next">
              {aal.next ?? "—"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p className="text-sm text-destructive" data-testid="account-security-error">
              {error}
            </p>
          ) : null}
          {factors.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="account-security-no-factors">
              لا توجد عوامل تحقق مسجّلة على هذا الحساب.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="account-security-factors">
              {factors.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span dir="ltr">{f.friendly_name ?? "TOTP"}</span>
                    <Badge variant={f.status === "verified" ? "default" : "secondary"}>
                      {f.status === "verified" ? "مُنشَّط" : "غير مكتمل"}
                    </Badge>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(f.id)}
                  >
                    إلغاء
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {pending ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <p className="text-sm font-medium">
                امسح رمز QR بتطبيق المصادقة ثم أدخل الرمز المكوّن من ٦ أرقام.
              </p>
              <img
                src={pending.qr}
                alt="رمز QR لتطبيق المصادقة"
                className="h-44 w-44 bg-white p-2"
                data-testid="account-security-qr"
              />
              <div className="space-y-2">
                <Label htmlFor="mfa-code">رمز التحقق</Label>
                <Input
                  id="mfa-code"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  data-testid="account-security-code"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={busy || code.trim().length < 6}
                  onClick={() => void confirmEnroll()}
                >
                  تأكيد التنشيط
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void remove(pending.id)}>
                  إلغاء العملية
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={busy}
              onClick={() => void startEnroll()}
              data-testid="account-security-enroll"
            >
              بدء التسجيل بتطبيق مصادقة
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        بعد تنشيط العامل، سيطلب النظام رمز التطبيق عند كل تسجيل دخول جديد، وتصبح العمليات الحسّاسة
        مقيّدة بجلسة مُتحقَّقة بخطوتين. جلستك الحالية لا تُقطع بهذه الصفحة.
      </p>
    </div>
  );
}
