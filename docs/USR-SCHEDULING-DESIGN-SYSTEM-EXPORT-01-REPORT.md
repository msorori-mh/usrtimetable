# USR-SCHEDULING-DESIGN-SYSTEM-EXPORT-01 — Final Report

**Mode:** Read-only analysis. No code, DB, or deploy changes were performed.

## 1. Files reviewed

See `docs/design-system-export/source-files-reviewed.txt`. Highlights:
- `src/styles.css` (Tailwind v4 CSS-first: `@theme inline`, `:root`, `.dark`, `@layer components`, `@media print`)
- `src/routes/__root.tsx` (font `<link>` loader, RTL shell, meta)
- `src/components/app-layout.tsx` (sidebar + nav groups)
- `src/components/branding/usr-brand-mark.tsx`, `src/lib/branding/usr.ts`
- `src/components/ui/{button,card,badge,input,...}.tsx`
- `package.json` (tailwindcss ^4.2.1, @tailwindcss/vite, lucide-react, sonner, cva, tailwind-merge)
- `public/branding/usr-university-logo.png`
- No `tailwind.config.*`, no `index.css`, no `app.css`, no favicon/PWA manifest.

## 2. Fonts (exact)

- **Body/UI:** `"Cairo", "Tajawal", system-ui, sans-serif` → token `--font-sans`. Weights 400, 500, 600, 700.
- **Display (h1–h4):** `"Tajawal", "Cairo", serif` → token `--font-display`. Weights 500, 700, 800.
- **Loader:** Google Fonts, via `<link rel="stylesheet">` inside `src/routes/__root.tsx` `head().links`:
  ```
  https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Tajawal:wght@500;700;800&display=swap
  ```
  With `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com`. Not local, not `@import`ed in CSS.

## 3. Color table (full)

Raw brand palette (from `:root`, exact hex):

| Var | Hex | Purpose |
|---|---|---|
| `--usr-primary` | `#105B7D` | primary |
| `--usr-primary-dark` | `#0B4964` | primary hover |
| `--usr-primary-deeper` | `#08384E` | sidebar/hero deep |
| `--usr-primary-soft` | `#E8F2F5` | soft surfaces/badges |
| `--usr-gold` | `#D99A17` | accent |
| `--usr-gold-dark` | `#B87900` | accent hover |
| `--usr-gold-soft` | `#FFF4DA` | warm surface |
| `--usr-bg` | `#F7F8FA` | app background |
| `--usr-card` | `#FFFFFF` | card surface |
| `--usr-border` | `#DDE6EA` | borders |
| `--usr-text` | `#102333` | foreground text |
| `--usr-muted` | `#667985` | muted text |

Semantic mapping to Tailwind utilities via `@theme inline` (all values, light + dark) is captured in `docs/design-system-export/USR-COLOR-PALETTE.md` and machine-readable in `USR-DESIGN-TOKENS.json`.

## 4. CSS variables & Tailwind mappings

- Every semantic token (`--background`, `--foreground`, `--card`, `--primary`, …, `--sidebar-*`) is aliased inside `@theme inline` as `--color-<name>: var(--name)`, so Tailwind v4 auto-generates `bg-*`, `text-*`, `border-*`, `ring-*` utilities.
- Font tokens (`--font-sans`, `--font-display`) generate `font-sans` and `font-display` utilities.
- Radius tokens (`--radius-sm/md/lg/xl/2xl`) generate `rounded-sm/md/lg/xl/2xl`.

No `tailwind.config.*` exists — the whole design system lives in `src/styles.css` (Tailwind v4 CSS-first).

## 5. Light vs dark

- **Light:** active in the shell (no `.dark` class applied anywhere). All hex values above are the actual runtime values.
- **Dark:** fully defined under `.dark` in oklch (see palette doc). No toggle is wired yet; the theme is ready to enable when the portal (or scheduler) chooses to.

## 6. Components in scope (portable)

`Button`, `Card`, `Badge`, `Input`, plus the entire shadcn/ui set (all consuming tokens): Dialog, Alert, Tabs, Table, Select, Sheet, Tooltip, Sonner, Sidebar. Namespaced `.usr-*` component classes (topbar, hero, auth-card, page-header, feature-card, institutional-card, gold-rule, access-notice) covered in `USR-COMPONENT-STYLES.md`.

## 7. Assets

- Logo: `public/branding/usr-university-logo.png` — portable.
- No favicon, no `manifest.json`, no PWA icons, no background raster assets, no project-owned SVGs. Icons come from `lucide-react` at runtime.

## 8. Portable vs scheduler-specific

Full split in `USR-PORTAL-TRANSFER-MANIFEST.md`. Summary:

**Portable:** tokens, fonts, `usr-*` utility classes, shadcn primitives, brand-mark, logo, root RTL shell, print rules.

**Excluded:** timetable UI, auto-scheduler, conflict engine, schedule-versions lifecycle, reports queries, scheduler nav list, scheduler-specific brand copy (`USR_PLATFORM_NAME_AR` etc.), Supabase integration files (project-specific by generation).

## 9. Hardcoded colors / caveats

- Two primitives (`ui/button.tsx`, `ui/badge.tsx`) reference `--usr-*` vars directly for hover states (e.g. `bg-[var(--usr-primary-dark)]`, `border-[var(--usr-border)]`). These are still token-driven and safe, but the portal must keep the `--usr-*` variable names when copying tokens, or rewrite those variant strings.
- No `#hex` literals or `bg-black`/`text-white` classes leak into shared UI.

## 10. Desktop vs mobile differences

- Sidebar (~16rem) is persistent on `md+`; on smaller screens it collapses behind a `Sheet` drawer opened from the header.
- Page containers cap at `max-w-3xl` (forms/settings) or wider for tables/reports; padding steps down from `p-6` on desktop to `p-4` on mobile.
- Hero typography uses `clamp()` and scales fluidly, so no separate mobile styles are required.
- Tailwind default breakpoints are used unchanged (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`).

## 11. Portal-readiness assessment

Prerequisites for a clean adoption:
- Portal on **Tailwind v4** with `@tailwindcss/vite`.
- Portal root can host an `<html lang="ar" dir="rtl">` shell (any framework works — TanStack Start, Next.js App Router with a root layout, or plain SPA).
- Portal head can inject Google Fonts `<link>` tags (never `@import` in CSS).
- Portal ships its own favicon/PWA assets (scheduler has none to inherit).

All conditions are met with the deliverables in `docs/design-system-export/`.

## Decision

**GO** → proceed to `PORTAL-USR-DESIGN-SYSTEM-ADOPT-01`.

## Compliance confirmations

- ✅ No code was modified.
- ✅ No design was changed.
- ✅ No database change.
- ✅ No migration executed.
- ✅ No deploy / no publish.
- ✅ No commit / no push.
- ✅ No functional / route / permission edit.

Only files created (documentation, non-code):

```
docs/USR-SCHEDULING-DESIGN-SYSTEM-EXPORT-01-REPORT.md
docs/design-system-export/USR-SCHEDULING-DESIGN-SYSTEM.md
docs/design-system-export/USR-FONTS.md
docs/design-system-export/USR-COLOR-PALETTE.md
docs/design-system-export/USR-COMPONENT-STYLES.md
docs/design-system-export/USR-RESPONSIVE-RTL.md
docs/design-system-export/USR-ASSET-INVENTORY.md
docs/design-system-export/USR-PORTAL-TRANSFER-MANIFEST.md
docs/design-system-export/USR-DESIGN-TOKENS.json
docs/design-system-export/source-files-reviewed.txt
```
