/**
 * SOURCE_ONLY_ADMIN_UX_INFORMATION_ARCHITECTURE_02
 * Static harness — proves the reorganised admin IA without touching DB/RBAC.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const navSrc = read("src/lib/admin-nav.tsx");
const layout = read("src/components/app-layout.tsx");
const tools = read("src/routes/_authenticated/admin-tools.tsx");
const tabs = read("src/components/ui/tabs.tsx");
const reports = read("src/routes/_authenticated/reports.index.tsx");
const availability = read("src/routes/_authenticated/availability.tsx");
const cleanup = read("src/routes/_authenticated/data-cleanup.tsx");

/* ---------------------------------------------------------------- 1. roles */
// Role matrix must stay byte-identical in intent to the pre-phase navigation:
// only these four roles exist, and the restricted entries keep their scope.
const roleTuples = [...navSrc.matchAll(/roles:\s*(\[[^\]]*\]|ALL_ROLES|WRITERS)/g)].map(
  (m) => m[1],
);
assert.ok(
  roleTuples.length > 30,
  `expected role declarations on every page, got ${roleTuples.length}`,
);
for (const t of roleTuples) {
  if (t === "ALL_ROLES" || t === "WRITERS") continue;
  for (const role of t.match(/"([a-z_]+)"/g) ?? []) {
    assert.ok(
      ["super_admin", "college_admin", "read_only", "institutional_viewer"].includes(
        role.replace(/"/g, ""),
      ),
      `unknown role in nav catalog: ${role}`,
    );
  }
}
assert.ok(
  navSrc.includes(
    'const WRITERS: Role[] = ["super_admin", "college_admin", "institutional_viewer"];',
  ),
  "writer-scoped role tuple must stay unchanged",
);
for (const superOnly of ["/universities", "/colleges", "/users"]) {
  const block = navSrc.slice(navSrc.indexOf(`to: "${superOnly}"`));
  assert.ok(
    /roles:\s*\["super_admin",\s*"institutional_viewer"\]/.test(block.slice(0, 400)),
    `${superOnly} must remain super_admin + institutional_viewer only`,
  );
}
const myCollegeBlock = navSrc.slice(navSrc.indexOf('to: "/my-college"'));
assert.ok(
  /roles:\s*\["college_admin",\s*"read_only",\s*"institutional_viewer"\]/.test(
    myCollegeBlock.slice(0, 400),
  ),
  "/my-college role scope must be unchanged",
);
for (const writerScoped of ["/import", "/data-cleanup", "/auto-schedule"]) {
  const block = navSrc.slice(
    navSrc.indexOf(`to: "${writerScoped}"`),
    navSrc.indexOf(`to: "${writerScoped}"`) + 400,
  );
  assert.ok(/roles:\s*WRITERS/.test(block), `${writerScoped} must keep writer role scope`);
}
// No RBAC/RLS/route-guard drift from this phase.
assert.equal(
  /can_manage_college|createServerFn|supabaseAdmin/.test(navSrc),
  false,
  "nav catalog must stay presentation-only",
);
assert.equal(/beforeLoad/.test(tools), false, "/admin-tools must not add its own route guard");

/* ------------------------------------------------------- 2. six core links */
const CORE = [
  ["/dashboard", "الرئيسية"],
  ["/data-onboarding", "تجهيز البيانات"],
  ["/schedule-builder", "بناء الجدول"],
  ["/schedule-versions", "المراجعة والاعتماد"],
  ["/published-schedules", "النشر والجداول الرسمية"],
  ["/reports", "التقارير"],
];
const corePathBlock = navSrc.slice(navSrc.indexOf("export const CORE_PATH"));
for (const [to, label] of CORE) {
  assert.ok(corePathBlock.includes(`to: "${to}"`), `core path missing ${to}`);
  assert.ok(corePathBlock.includes(`label: "${label}"`), `core path missing label ${label}`);
}
for (const step of ['step: "1"', 'step: "2"', 'step: "3"', 'step: "4"']) {
  assert.ok(corePathBlock.includes(step), `missing numeric step badge ${step}`);
}
// Numbers are badges, not label text.
assert.equal(
  /label: "\d\./.test(corePathBlock),
  false,
  "step numbers must not be inlined in labels",
);
assert.ok(layout.includes("المسار التشغيلي"), "core mode must be described in navigation");
assert.ok(
  layout.includes('data-testid="navigation-mode-toggle"'),
  "mode toggle must stay testable",
);
assert.ok(layout.includes("NAV_MODE_STORAGE_KEY"), "nav mode must persist locally");
assert.ok(
  layout.includes("window.localStorage.getItem(NAV_MODE_STORAGE_KEY)"),
  "nav mode must read from localStorage only",
);

/* --------------------------------------------- 3. legacy hidden from nav */
assert.equal(
  /to:\s*"\/sections"/.test(layout),
  false,
  "/sections must not appear in the layout navigation",
);
const adminPagesBlock = navSrc.slice(
  navSrc.indexOf("export const ADMIN_PAGES"),
  navSrc.indexOf("export const LEGACY_ADMIN_PAGES"),
);
for (const legacyRoute of ["/sections", "/course-offerings"]) {
  assert.equal(
    adminPagesBlock.includes(`to: "${legacyRoute}"`),
    false,
    `${legacyRoute} must live only in the legacy list`,
  );
  assert.ok(
    navSrc.includes(`to: "${legacyRoute}"`),
    `${legacyRoute} must remain reachable via the legacy list`,
  );
}
assert.equal(
  adminPagesBlock.includes("المجموعات الدراسية"),
  false,
  "legacy sections must not be named «المجموعات الدراسية»",
);
assert.ok(
  navSrc.includes('label: "مجموعات المحاضرات والمعامل"'),
  "delivery groups label preserved",
);
assert.ok(navSrc.includes('label: "الدفعات الدراسية"'), "cohorts label preserved");
assert.ok(navSrc.includes('label: "ساعات وفترات الدوام"'), "/time-slots renamed");
assert.ok(
  navSrc.includes("المرجع المعتمد لأوقات المحاضرات"),
  "/time-slot-templates must be the stated source of truth for lecture times",
);
const importTemplatesBlock = navSrc.slice(navSrc.indexOf('to: "/import-templates"'));
assert.ok(
  /tier:\s*"advanced"/.test(importTemplatesBlock.slice(0, 400)),
  "/import-templates must be classified advanced",
);
for (const dataJourneyRoute of ["/data-templates", "/import", "/import-history"]) {
  const b = navSrc.slice(navSrc.indexOf(`to: "${dataJourneyRoute}"`));
  assert.ok(
    /journey:\s*"data"/.test(b.slice(0, 500)),
    `${dataJourneyRoute} must sit in one data journey`,
  );
}

/* ----------------------------------------------------- 4. /admin-tools gate */
assert.ok(
  tools.includes('createFileRoute("/_authenticated/admin-tools")'),
  "/admin-tools must be an authenticated route",
);
assert.ok(
  tools.includes("canAccess(p, roles)"),
  "/admin-tools must filter cards by the shared role matrix",
);
assert.ok(tools.includes("useCurrentUser"), "/admin-tools must read the current user roles");
assert.ok(tools.includes("ROLE_LABEL"), "cards must state who can access");
assert.ok(tools.includes("TIER_LABEL"), "cards must state basic vs advanced");
assert.ok(
  tools.includes("أدوات قديمة وتشخيصية"),
  "legacy tools must be in a secondary collapsed section",
);
assert.ok(
  tools.includes("LEGACY_ADMIN_PAGES"),
  "legacy list must be separate from the default grid",
);
assert.ok(tools.includes("legacyOpen"), "legacy section must be collapsed by default");
assert.ok(tools.includes("useState(false)"), "legacy section default state must be closed");
for (const j of [
  "المؤسسة والصلاحيات",
  "البنية الأكاديمية",
  "الكادر والقاعات",
  "أوقات العمل والتوفر",
  "تجهيز الجدولة",
  "تنفيذ الجدول والتحقق",
  "البيانات والاستيراد",
  "التقارير",
]) {
  assert.ok(navSrc.includes(j), `journey group missing: ${j}`);
}

/* ------------------------------------------------ 5. tabs: RTL/active/overflow */
assert.ok(tabs.includes('dir="rtl"'), "TabsList must be RTL-explicit");
assert.ok(tabs.includes("overflow-x-auto"), "tabs must scroll horizontally on mobile");
assert.ok(tabs.includes("whitespace-nowrap"), "tabs must not wrap");
assert.equal(/flex-wrap/.test(tabs), false, "tabs must never wrap");
assert.ok(
  tabs.includes("data-[state=active]:bg-primary"),
  "active tab must use strong primary contrast",
);
assert.ok(tabs.includes("var(--usr-gold)"), "active tab must carry the USR gold marker");
assert.ok(tabs.includes("focus-visible:ring-2"), "tabs must expose a focus ring");
assert.ok(tabs.includes("disabled:opacity-50"), "tabs must expose a disabled state");
assert.ok(tabs.includes("hover:bg-background/70"), "tabs must expose a hover state");
assert.equal(
  /flex-wrap/.test(cleanup.slice(cleanup.indexOf("<TabsList"), cleanup.indexOf("</TabsList>"))),
  false,
  "data-cleanup tabs must use the shared scrollable pattern",
);
assert.ok(availability.includes("<TabsList>"), "availability must use the shared tab styling");

/* ------------------------------------------- 6. breadcrumb / context / mobile */
assert.ok(layout.includes("resolveBreadcrumb"), "layout must render a contextual breadcrumb");
assert.ok(navSrc.includes("export function resolveBreadcrumb"), "breadcrumb resolver must exist");
assert.ok(layout.includes('data-testid="page-context-bar"'), "context bar must be testable");
assert.ok(layout.includes("activeCollege.name"), "active college name must appear near the header");
assert.equal(
  layout.includes("CollegeSwitcher"),
  false,
  "layout must not duplicate the CollegeSwitcher control",
);
assert.ok(layout.includes("<Sheet"), "mobile navigation must use the Sheet component");
assert.equal(/<details/.test(layout), false, "the old details-based mobile menu must be gone");
assert.ok(layout.includes("setMobileOpen(false)"), "mobile menu must close after navigation");
assert.ok(
  layout.includes('data-testid="nav-page-search"'),
  "all-tools mode must expose instant search",
);

/* --------------------------------------------------- 7. reports legacy fold */
assert.ok(
  reports.includes('data-testid="reports-legacy-section"'),
  "legacy reports section must be marked",
);
assert.ok(reports.includes("legacyOpen"), "legacy reports must be collapsed by default");
assert.ok(
  reports.includes("LEGACY_SECTION"),
  "legacy reports must be outside the primary sections list",
);
const primarySections = reports.slice(
  reports.indexOf("const SECTIONS"),
  reports.indexOf("const LEGACY_SECTION"),
);
assert.equal(
  primarySections.includes("LEGACY_REPORTS"),
  false,
  "legacy reports must not be listed among primary report sections",
);

console.log(
  JSON.stringify(
    {
      harness: "admin-ux-information-architecture",
      corePathLinks: CORE.length,
      journeys: 8,
      status: "pass",
    },
    null,
    2,
  ),
);
