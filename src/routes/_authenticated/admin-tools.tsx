import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, LayoutGrid, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useActiveCollege } from "@/hooks/use-colleges";
import {
  ADMIN_PAGES,
  JOURNEYS,
  LEGACY_ADMIN_PAGES,
  canAccess,
  matchesQuery,
  pagesByJourney,
  type AdminPage,
  type Role,
} from "@/lib/admin-nav";
import { ACADEMIC_AFFAIRS_ROLE_LABEL_AR } from "@/lib/viewer-roles";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin-tools")({
  head: () => ({
    meta: [
      { title: "مركز الأدوات الإدارية — جامعة إقليم سبأ" },
      {
        name: "description",
        content: "بوابة منظمة لكل صفحات الإعداد الإداري مرتبة حسب رحلة العمل مع بحث فوري.",
      },
      { property: "og:title", content: "مركز الأدوات الإدارية — جامعة إقليم سبأ" },
      {
        property: "og:description",
        content: "بوابة منظمة لكل صفحات الإعداد الإداري مرتبة حسب رحلة العمل مع بحث فوري.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminToolsPage,
});

const TIER_LABEL: Record<AdminPage["tier"], string> = {
  basic: "إعداد أساسي",
  advanced: "إعداد متقدم",
  legacy: "قديم/تشخيصي",
};

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  college_admin: "مدير كلّية",
  read_only: "مشاهد",
  institutional_viewer: ACADEMIC_AFFAIRS_ROLE_LABEL_AR,
};

function ToolCard({ page }: { page: AdminPage }) {
  const Icon = page.icon;
  return (
    <Link to={page.to} className="block" aria-label={page.label}>
      <Card className="h-full p-4 transition-shadow hover:shadow-md">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{page.label}</span>
              <Badge
                variant={page.tier === "basic" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {TIER_LABEL[page.tier]}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{page.desc}</p>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              الوصول: {page.roles.map((r) => ROLE_LABEL[r]).join(" · ")}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function AdminToolsPage() {
  const { data: me } = useCurrentUser();
  const { active } = useActiveCollege();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [legacyOpen, setLegacyOpen] = useState(false);

  const roles = me?.roles as Role[] | undefined;

  const visible = useMemo(
    () =>
      ADMIN_PAGES.filter((p) => !p.hiddenFromMenu && canAccess(p, roles) && matchesQuery(p, query)),
    [roles, query],
  );
  const grouped = useMemo(() => pagesByJourney(visible), [visible]);
  const legacy = useMemo(
    () => LEGACY_ADMIN_PAGES.filter((p) => canAccess(p, roles) && matchesQuery(p, query)),
    [roles, query],
  );

  return (
    <div className="space-y-6" dir="rtl">
      <header className="usr-page-header">
        <span className="usr-page-header-icon">
          <LayoutGrid className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">مركز الأدوات الإدارية</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            كل صفحات الإعداد مرتبة حسب رحلة العمل — للقراءة والتنقل فقط.
            {active ? ` الكلّية النشطة: ${active.name}` : ""}
          </p>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن صفحة… (مثال: قاعات، دفعات، استيراد)"
          className="pr-9"
          data-testid="admin-tools-search"
          aria-label="بحث عن صفحة إدارية"
        />
      </div>

      {visible.length === 0 && legacy.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          لا توجد صفحات مطابقة للبحث.
        </p>
      )}

      {JOURNEYS.map((j) => {
        const items = grouped.get(j.key) ?? [];
        if (items.length === 0) return null;
        const isCollapsed = !!collapsed[j.key];
        return (
          <section key={j.key} className="rounded-xl border border-border/70 bg-card/40 p-4">
            <button
              type="button"
              onClick={() => setCollapsed((s) => ({ ...s, [j.key]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between gap-3 text-right"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                    {j.order}
                  </span>
                  <span className="text-lg font-semibold">{j.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {items.length}
                  </Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{j.desc}</span>
              </span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 transition-transform", isCollapsed && "rotate-180")}
              />
            </button>
            {!isCollapsed && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((p) => (
                  <ToolCard key={p.to} page={p} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {legacy.length > 0 && (
        <section
          className="rounded-xl border border-warning/40 bg-warning/5 p-4"
          data-testid="admin-tools-legacy-section"
        >
          <button
            type="button"
            onClick={() => setLegacyOpen((v) => !v)}
            aria-expanded={legacyOpen}
            className="flex w-full items-center justify-between gap-3 text-right"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-base font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning-foreground" />
                أدوات قديمة وتشخيصية
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                تحذير: هذه الشاشات محفوظة للتوافق والتشخيص فقط ولا تُستخدم في التشغيل اليومي؛ قد
                تعرض بيانات قديمة أو مولَّدة.
              </span>
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", legacyOpen && "rotate-180")}
            />
          </button>
          {legacyOpen && (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {legacy.map((p) => (
                <ToolCard key={p.to} page={p} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
