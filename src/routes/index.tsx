import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Building2, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import {
  USR_ACCESS_NOTICE_AR,
  USR_FOOTER_AR,
  USR_PLATFORM_DESC_AR,
  USR_PLATFORM_NAME_AR,
  USR_UNIVERSITY_NAME_AR,
} from "@/lib/branding/usr";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${USR_PLATFORM_NAME_AR} — ${USR_UNIVERSITY_NAME_AR}` },
      {
        name: "description",
        content: `${USR_PLATFORM_DESC_AR} — ${USR_UNIVERSITY_NAME_AR}`,
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  const loginTo = authed ? "/dashboard" : "/auth";
  const loginLabel = authed ? "لوحة التحكم" : "تسجيل الدخول";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="usr-topbar">{USR_UNIVERSITY_NAME_AR}</div>
      <div className="usr-gold-rule shrink-0" />

      <header className="usr-nav-header">
        <UsrBrandMark size="lg" className="rounded-xl shrink-0" />
        <div className="usr-nav-brand-text">
          <p className="usr-nav-university">{USR_UNIVERSITY_NAME_AR}</p>
          <p className="usr-nav-platform">{USR_PLATFORM_NAME_AR}</p>
        </div>
      </header>

      <section className="usr-hero-deep">
        <div className="usr-hero-deep-inner">
          <UsrBrandMark size="hero" variant="onPrimary" className="mx-auto rounded-2xl mb-6" />
          <h1 className="usr-hero-university">{USR_UNIVERSITY_NAME_AR}</h1>
          <p className="usr-hero-platform">{USR_PLATFORM_NAME_AR}</p>
          <p className="usr-hero-desc">{USR_PLATFORM_DESC_AR}</p>
          <p className="usr-access-notice usr-access-notice--on-dark mt-5 max-w-lg mx-auto">
            {USR_ACCESS_NOTICE_AR}
          </p>
          <div className="mt-8">
            <Link to={loginTo} className="usr-hero-cta">
              {loginLabel}
            </Link>
          </div>
        </div>
      </section>

      <section className="usr-features-section">
        <div className="mx-auto max-w-5xl">
          <h2 className="usr-section-title text-center mb-5 text-muted-foreground text-base font-medium">
            مكوّنات المنصّة
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <FeatureCard
              icon={<Building2 className="h-4 w-4" />}
              title="إدارة الكلّيات"
              desc="تنظيم الهيكل الأكاديمي للجامعة"
            />
            <FeatureCard
              icon={<Users className="h-4 w-4" />}
              title="إدارة المستخدمين"
              desc="إسناد الأدوار من قبل المشرف العام"
            />
            <FeatureCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="صلاحيات دقيقة"
              desc="عزل بيانات كل كلّية وفق السياسات"
            />
            <FeatureCard
              icon={<GraduationCap className="h-4 w-4" />}
              title="جاهز للتوسّع"
              desc="أساس مرن للجدولة والتقارير"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-surface py-5 mt-auto">
        <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <UsrBrandMark size="md" className="opacity-90" />
          <p>
            {USR_FOOTER_AR} — {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="usr-feature-card-lite">
      <div className="usr-feature-icon mb-2.5">{icon}</div>
      <p className="font-semibold text-sm text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
