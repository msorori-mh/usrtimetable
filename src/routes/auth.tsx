import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import {
  USR_AUTH_NOTICE_AR,
  USR_PLATFORM_DESC_AR,
  USR_PLATFORM_NAME_AR,
  USR_UNIVERSITY_NAME_AR,
} from "@/lib/branding/usr";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: `تسجيل الدخول — ${USR_PLATFORM_NAME_AR}` }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("مرحباً بك");
      const { data } = await supabase.auth.getUser();
      if (data.user) navigate({ to: "/dashboard", replace: true });
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
                <Input
                  id="password"
                  type="password"
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
