# USR — Component Styles (portable primitives)

Base stack: shadcn/ui + Radix primitives, styled with Tailwind v4 semantic
tokens and `class-variance-authority`. All primitives listed here are visually
identity-bearing and portable to the portal project.

## Button (`src/components/ui/button.tsx`)

Base classes:
`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4`

Variants:
- `default` — `bg-primary text-primary-foreground shadow` → hover `bg-[var(--usr-primary-dark)]`
- `destructive` — `bg-destructive text-destructive-foreground shadow-sm` → hover `bg-destructive/90`
- `outline` — `border border-[var(--usr-border)] bg-background shadow-sm` → hover `bg-[var(--usr-primary-soft)] text-[var(--usr-primary-dark)]`
- `secondary` — `bg-secondary text-secondary-foreground shadow-sm` → hover `bg-secondary/80`
- `ghost` — hover `bg-accent text-accent-foreground`
- `link` — `text-primary underline-offset-4 hover:underline`

Sizes: `default h-9 px-4 py-2`, `sm h-8 px-3 text-xs`, `lg h-10 px-8`, `icon h-9 w-9`.

## Card (`src/components/ui/card.tsx`)
`rounded-xl border bg-card text-card-foreground shadow-[var(--shadow-card)]`
Header/Content/Footer padding: `p-6` (`pt-0` on non-header slots).
Title: `font-semibold leading-none tracking-tight`.
Description: `text-sm text-muted-foreground`.

## Badge (`src/components/ui/badge.tsx`)
`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold`
Variants mirror Button (default/secondary/destructive/outline) with the same
USR hover colors.

## Input (`src/components/ui/input.tsx`)
`h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm md:text-sm`
Focus: `focus-visible:ring-1 focus-visible:ring-ring`. Disabled: `opacity-50`.

## Table, Dialog, Alert, Tabs, Select, Sheet, Tooltip, Sonner
Standard shadcn implementations, unmodified — all consume `--card`,
`--border`, `--muted`, `--foreground`, `--primary`, `--ring` tokens. They
render correctly wherever the token block from `src/styles.css` is present.
Toaster: `sonner` mounted once in `__root.tsx`.

## Sidebar / navigation (`src/components/app-layout.tsx`)
- Container: `bg-sidebar text-sidebar-foreground` (deep primary `#08384E`).
- Active nav item: `bg-sidebar-accent text-sidebar-accent-foreground`.
- Hover: `bg-sidebar-accent/60`.
- Grouped sections with muted Arabic group titles.
- Icons: `lucide-react`, `h-4 w-4`, sit at start of item (RTL-aware via row direction).

## Utility component classes (defined in `src/styles.css` `@layer components`)

All prefixed `usr-*`; use these instead of ad-hoc composition on portal pages
that mirror scheduler screens (auth, marketing, page headers):

- `.usr-topbar` — thin deep bar (top strip)
- `.usr-nav-header`, `.usr-nav-brand-text`, `.usr-nav-university`, `.usr-nav-platform`
- `.usr-site-header`, `.usr-gold-rule` (4px gold divider)
- `.usr-hero-deep`, `.usr-hero-deep-inner`, `.usr-hero-university`, `.usr-hero-platform`, `.usr-hero-desc`, `.usr-hero-cta`
- `.usr-access-notice`, `.usr-access-notice--on-dark`
- `.usr-features-section`, `.usr-feature-card-lite`, `.usr-feature-icon`
- `.usr-auth-card`, `.usr-auth-header`
- `.usr-page-header`, `.usr-page-header-icon`, `.usr-section-title`
- `.usr-institutional-card` (bordered card with hover primary border)
- `.usr-internal-main`, `.usr-dashboard-header`

## Empty / loading / error patterns
- Empty state: centered `text-muted-foreground` inside a `Card` with icon.
- Loading: `text-center text-muted-foreground` ("جارٍ التحميل…") — no skeletons across most pages.
- Error: `Card` with `AlertTriangle` icon + destructive text; forms use `sonner` toast.

## Icon library
`lucide-react` exclusively. Sizes: `h-4 w-4` (in-line), `h-5 w-5` (page-header icons in a `2.75rem` rounded box), `h-11 w-11` for framed icon chips.
