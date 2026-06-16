import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — منصّة الجداول الجامعية" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("تم إنشاء الحساب بنجاح");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحباً بك");
      }
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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-[image:var(--gradient-hero)] p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-white/15 backdrop-blur">
            <GraduationCap className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold">منصّة الجداول الجامعية</p>
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-tight">
            النظام الموحد لإدارة الجداول الدراسية في جميع الكليات
          </h2>
          <p className="mt-4 max-w-md text-primary-foreground/80">
            أوّل مستخدم يُسجَّل في النظام يحصل تلقائياً على صلاحيات
            <span className="mx-1 rounded bg-white/15 px-2 py-0.5 text-xs font-semibold">المدير العام</span>
            لإعداد الجامعة والكلّيات.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">المرحلة الأولى — الأساس</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="mb-2 text-2xl font-bold">
            {mode === "signin" ? "تسجيل الدخول" : "إنشاء حساب جديد"}
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            {mode === "signin"
              ? "ادخل ببياناتك للوصول إلى لوحة التحكم."
              : "أنشئ حساباً للوصول إلى لوحة التحكم."}
          </p>

          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">دخول</TabsTrigger>
              <TabsTrigger value="signup">حساب جديد</TabsTrigger>
            </TabsList>
            <TabsContent value={mode} className="mt-6">
              <form onSubmit={handle} className="space-y-4">
                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="fullName">الاسم الكامل</Label>
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="د. محمد أحمد" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">البريد الإلكتروني</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@university.edu" dir="ltr" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "جارٍ المعالجة..." : mode === "signin" ? "دخول" : "إنشاء حساب"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function translateAuthError(msg: string): string {
  if (msg.includes("Invalid login")) return "بيانات الدخول غير صحيحة";
  if (msg.includes("already registered")) return "هذا البريد مسجَّل مسبقاً";
  if (msg.includes("Password should")) return "كلمة المرور قصيرة (٦ أحرف على الأقل)";
  return msg;
}
