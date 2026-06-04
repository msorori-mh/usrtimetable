import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Building2, GraduationCap, ShieldCheck, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "نظام إدارة الجداول الجامعية" },
      { name: "description", content: "منصة موحّدة لإدارة الكليات والمستخدمين والصلاحيات داخل الجامعة." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[image:var(--gradient-hero)] text-primary-foreground">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">منصّة الجداول الجامعية</p>
              <p className="text-xs text-muted-foreground">إدارة متعددة الكليات</p>
            </div>
          </div>
          <Link
            to={authed ? "/dashboard" : "/auth"}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            {authed ? "لوحة التحكم" : "تسجيل الدخول"}
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold text-accent-foreground">
                المرحلة الأولى — الأساس
              </span>
              <h1 className="mt-4 text-4xl font-bold leading-tight md:text-5xl">
                منصّة موحّدة لإدارة <span className="text-primary">كلّيات جامعتك</span>
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                ابدأ بإعداد جامعتك وكلّياتها، ثم أنشئ مستخدمين وعيّن صلاحياتهم.
                الأساس الذي ستُبنى عليه لاحقاً وحدات الأقسام، المواد، الجداول، والتقارير.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={authed ? "/dashboard" : "/auth"}
                  className="rounded-md bg-[image:var(--gradient-hero)] px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition hover:opacity-90"
                >
                  {authed ? "الانتقال للوحة التحكم" : "ابدأ الآن"}
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FeatureCard icon={<Building2 className="h-5 w-5" />} title="إدارة الكليات" desc="إنشاء وتنظيم كلّيات الجامعة" />
              <FeatureCard icon={<Users className="h-5 w-5" />} title="إدارة المستخدمين" desc="إضافة وإسناد مستخدمين للكليات" />
              <FeatureCard icon={<ShieldCheck className="h-5 w-5" />} title="صلاحيات دقيقة" desc="عزل بيانات كل كلية بأمان" />
              <FeatureCard icon={<GraduationCap className="h-5 w-5" />} title="جاهز للتوسع" desc="أساس مرن لإضافة الأقسام والجداول" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} — منصّة إدارة الجداول الجامعية
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-secondary text-primary">
        {icon}
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

// silence unused import warning while keeping API symmetric
void redirect;
