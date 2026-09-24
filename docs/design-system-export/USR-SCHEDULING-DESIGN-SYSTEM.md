# USR Scheduling — Design System (Master)

This is the umbrella document for the read-only export produced by phase
`USR-SCHEDULING-DESIGN-SYSTEM-EXPORT-01`. All sibling files in this folder
are considered part of one deliverable set.

## Index

1. [USR-FONTS.md](./USR-FONTS.md) — Typography (Cairo body, Tajawal display) and loader.
2. [USR-COLOR-PALETTE.md](./USR-COLOR-PALETTE.md) — Raw brand + semantic tokens (light & dark).
3. [USR-COMPONENT-STYLES.md](./USR-COMPONENT-STYLES.md) — Portable primitives (button/card/badge/input/sidebar/utility classes).
4. [USR-RESPONSIVE-RTL.md](./USR-RESPONSIVE-RTL.md) — RTL, breakpoints, spacing, print behavior.
5. [USR-ASSET-INVENTORY.md](./USR-ASSET-INVENTORY.md) — Logos, brand strings, missing assets.
6. [USR-DESIGN-TOKENS.json](./USR-DESIGN-TOKENS.json) — Machine-readable token export.
7. [USR-PORTAL-TRANSFER-MANIFEST.md](./USR-PORTAL-TRANSFER-MANIFEST.md) — Copy/adapt/exclude checklist for the portal adoption phase.
8. [source-files-reviewed.txt](./source-files-reviewed.txt) — Provenance.

## Executive summary

- **Stack:** TanStack Start (React 19) · Tailwind v4 (CSS-first, no `tailwind.config.*`) · shadcn/ui on Radix · `lucide-react` icons · `sonner` toasts.
- **Identity:** Institutional deep teal-blue `#105B7D` (primary), deeper `#08384E` (sidebar/hero), gold `#D99A17` (accent/dividers/CTA). Neutral canvas `#F7F8FA` on cards `#FFFFFF` with soft `#DDE6EA` borders.
- **Typography:** Body/UI **Cairo** (400/500/600/700), display **Tajawal** (500/700/800). Loaded via Google Fonts `<link>` in the root route.
- **Direction:** RTL globally (`<html lang="ar" dir="rtl">` + `html { direction: rtl }`).
- **Theming:** Light theme active. A complete oklch-based dark theme is defined under `.dark` but no toggle is wired.
- **Shadows/radius:** Base radius `0.625rem`; `--shadow-card` and `--shadow-elevated` provide the depth language.
- **Namespaced utility classes:** `.usr-*` component classes in `@layer components` encode the shell, hero, auth card, page header, feature card, and gold divider — all portable.

## Portability verdict

Everything under [`docs/design-system-export/`](./) is safe to adopt on the
portal project. The scheduler-specific UI (timetable grid, auto-scheduler,
conflict engine, reports queries) is explicitly excluded — see the transfer
manifest for the split.

## Compliance confirmations (this phase)

- No source code was modified.
- No design was altered.
- No database change, no migration, no Supabase edit.
- No deploy, no commit, no push.
- No functional route, permission, or business-logic edit.
