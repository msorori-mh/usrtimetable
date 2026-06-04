import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Building2, School, Users, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "لوحة التحكم" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: user } = useCurrentUser();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", user?.isSuperAdmin],
    enabled: !!user,
    queryFn: async () => {
      const [unis, colleges, profiles] = await Promise.all([
        supabase.from("universities").select("id", { count: "exact", head: true }),
        supabase.from("colleges").select("id", { count: "exact", head: true }),
        user?.isSuperAdmin
          ? supabase.from("profiles").select("id", { count: "exact", head: true })
          : Promise.resolve({ count: null }),
      ]);
      return {
        universities: unis.count ?? 0,
        colleges: colleges.count ?? 0,
        users: profiles.count,
      };
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8">
        <p className="text-sm text-muted-foreground">مرحباً بك،</p>
        <h1 className="mt-1 text-3xl font-bold">{user?.fullName ?? user?.email}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.isSuperAdmin
            ? "لديك صلاحية إدارة الجامعة وجميع الكلّيات."
            : user?.isCollegeAdmin
              ? "لديك صلاحية إدارة كلّيتك."
              : "لديك صلاحية قراءة بيانات كلّيتك."}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={<Building2 className="h-5 w-5" />} label="الجامعات" value={stats?.universities ?? "—"} />
        <StatCard icon={<School className="h-5 w-5" />} label="الكلّيات المتاحة لك" value={stats?.colleges ?? "—"} />
        {user?.isSuperAdmin && (
          <StatCard icon={<Users className="h-5 w-5" />} label="المستخدمون" value={stats?.users ?? "—"} />
        )}
      </div>

      {user?.isSuperAdmin && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">إجراءات سريعة</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <QuickLink to="/universities" title="إدارة الجامعة" desc="إنشاء/تعديل بيانات الجامعة" />
            <QuickLink to="/colleges" title="إدارة الكلّيات" desc="إضافة وتعديل الكلّيات" />
            <QuickLink to="/users" title="إدارة المستخدمين" desc="إضافة مستخدمين وإسناد صلاحياتهم" />
          </div>
        </section>
      )}

      {!user?.isSuperAdmin && (
        <section className="mt-10">
          <QuickLink to="/my-college" title="الانتقال إلى كلّيتي" desc="عرض البيانات الخاصة بكلّيتك" />
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-primary">{icon}</span>
      </div>
      <p className="mt-3 text-3xl font-bold">{value}</p>
    </div>
  );
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-[var(--shadow-card)]"
    >
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      <ArrowLeft className="h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
    </Link>
  );
}
