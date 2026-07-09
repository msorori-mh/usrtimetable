# USR — Portal Transfer Manifest

Prescriptive list of what to copy, adapt, or leave behind when adopting the
scheduler's visual identity in the portal project.

## A. Copy verbatim (portable identity)

| Item | Source | Target action |
|---|---|---|
| Design tokens block (`:root` + `.dark` + `@theme inline`) | `src/styles.css` (lines: from `@theme inline` to end of `:root`/`.dark`) | Paste into portal's `src/styles.css` (Tailwind v4). Keep every `--usr-*` and every `--color-*` mapping identical. |
| Font `<link>` and preconnects | `src/routes/__root.tsx` head().links | Put in portal's root route head — never `@import` these fonts in CSS. |
| USR brand strings | `src/lib/branding/usr.ts` — keep `USR_UNIVERSITY_NAME_AR`, `USR_TAGLINE_AR`, `USR_UNIVERSITY_LOGO_SRC`, `USR_COLLEGE_NAME_FALLBACK_AR`, `USR_ACCESS_NOTICE_AR` | Copy into a `portal/branding/usr.ts`. Rename `USR_PLATFORM_NAME_AR` / `USR_PLATFORM_DESC_AR` to the portal's own copy. |
| Logo asset | `public/branding/usr-university-logo.png` | Copy to portal `public/branding/`. |
| Brand-mark component | `src/components/branding/usr-brand-mark.tsx` | Copy as-is. |
| Utility component CSS classes | `src/styles.css` `@layer components` — the entire `usr-*` block | Copy the whole block; safe/generic (topbar, hero, auth-card, feature-card, page-header, institutional-card, gold-rule, access-notice). |
| shadcn/ui primitives with USR tweaks | `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx` | Copy as-is; they already consume the tokens. |
| Print rules | `src/styles.css` `@media print` block | Copy only if the portal ships printable reports. |
| Root `<html lang="ar" dir="rtl" data-theme="usr">` + RTL base rule | `src/routes/__root.tsx` shellComponent + `html { direction: rtl }` in styles | Mirror on portal root. |
| Meta template | `head().meta` shape (title/description in Arabic) | Adapt with portal-specific copy. |

## B. Adapt (identity kept, structure reworked)

- **App shell / sidebar** (`src/components/app-layout.tsx`): reuse token/class patterns (`bg-sidebar`, `usr-page-header`, `usr-institutional-card`) but rebuild the nav array around portal routes. Do NOT copy the scheduler `NAV` list.
- **Auth screens**: reuse `.usr-auth-card` + `.usr-auth-header` + `.usr-hero-*` classes; write portal-specific content inside.
- **Empty/loading/error patterns**: reuse `Card` + `lucide-react` icons + `text-muted-foreground` copy pattern.

## C. Do NOT transfer (scheduler-only)

- All timetable/grid UI: `src/components/timetable/*`, `src/components/reports/timetable-grid-report.tsx`.
- Auto-scheduler and conflict logic: `src/lib/auto-scheduler/*`, `src/lib/conflict-engine/*`, `src/lib/schedule-versions/*`.
- Reports queries: `src/lib/reports/queries/*`, `src/lib/reports/readiness.ts`, `capacity-baseline.ts`.
- Scheduler routes under `src/routes/_authenticated/*` (except the pattern of using `_authenticated` layout — that's a TanStack Start convention worth keeping if portal has auth).
- `src/integrations/supabase/*` (auto-generated per project; the portal will have its own).
- Scheduler brand copy: `USR_PLATFORM_NAME_AR`, `USR_PLATFORM_DESC_AR`, `USR_AUTH_NOTICE_AR`, `USR_FOOTER_AR` (rewrite for portal).
- Sidebar nav array in `app-layout.tsx` (scheduler-specific routes).

## D. Watch-outs

- **Tailwind v4 only.** Portal must be on `tailwindcss ^4` with `@tailwindcss/vite`. If it is on v3, tokens must be moved into `tailwind.config.js` instead — the `@theme inline` syntax will silently no-op.
- **No `@import` of Google Fonts in CSS.** Lightning CSS treats URLs as filesystem paths and the build breaks. Always via `<link>`.
- **Hard-coded token references in Button/Badge**: two variants use `bg-[var(--usr-primary-dark)]` etc. That works only if the `--usr-*` vars are defined in the portal's `:root`. If the portal renames them, edit those variants too.
- **No dark theme in production yet.** The `.dark` block is defined but no toggle is wired. Portal can wire a theme toggle when needed without changing tokens.
- **No favicon/PWA assets present.** Portal must create its own.

## E. GO/NO-GO checklist for `PORTAL-USR-DESIGN-SYSTEM-ADOPT-01`

- [x] All token values documented with hex + var + semantic mapping.
- [x] Fonts documented with exact loader URL and weights.
- [x] Component variants captured with class strings.
- [x] Portable vs scheduler-specific split explicit.
- [x] Logo path + brand strings inventoried.
- [x] Print + RTL + responsive behavior recorded.

**Decision: GO** — inventory is complete and self-contained; portal adoption can proceed against these documents without re-reading scheduler source.
