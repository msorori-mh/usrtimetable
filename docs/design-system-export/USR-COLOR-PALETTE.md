# USR — Color Palette

All colors are defined as CSS custom properties in `src/styles.css` and exposed
to Tailwind v4 via an `@theme inline` block, so utilities like `bg-primary`,
`text-muted-foreground`, `border-border`, `bg-sidebar`, etc. resolve to the
values below. Never hard-code hex values in components — always consume a token.

## Raw brand palette (`:root` — Phase 1.6B-2 “USR exact palette”)

| Token | HEX | Purpose |
|---|---|---|
| `--usr-primary` | `#105B7D` | Institutional deep teal-blue (primary brand) |
| `--usr-primary-dark` | `#0B4964` | Primary hover / darker accents |
| `--usr-primary-deeper` | `#08384E` | Sidebar, hero deepest tone, page-header dark text |
| `--usr-primary-soft` | `#E8F2F5` | Secondary surfaces, subtle backgrounds, badge fills |
| `--usr-gold` | `#D99A17` | Institutional gold accent (dividers, CTA, warnings) |
| `--usr-gold-dark` | `#B87900` | Gold hover / gradient stops |
| `--usr-gold-soft` | `#FFF4DA` | Warm surfaces (feature icons, notice cards) |
| `--usr-bg` | `#F7F8FA` | Application background |
| `--usr-card` | `#FFFFFF` | Card / surface background |
| `--usr-border` | `#DDE6EA` | Standard border color |
| `--usr-text` | `#102333` | Primary foreground text |
| `--usr-muted` | `#667985` | Muted / secondary text |

## Semantic tokens (light theme, mapped in `:root`)

| Semantic token | Value | Tailwind utility root |
|---|---|---|
| `--background` | `var(--usr-bg)` = `#F7F8FA` | `bg-background` |
| `--foreground` | `var(--usr-text)` = `#102333` | `text-foreground` |
| `--surface` / `--card` / `--popover` | `#FFFFFF` | `bg-card`, `bg-popover` |
| `--card-foreground` / `--surface-foreground` / `--popover-foreground` | `#102333` | `text-card-foreground` |
| `--primary` | `#105B7D` | `bg-primary`, `text-primary` |
| `--primary-foreground` | `#FFFFFF` | `text-primary-foreground` |
| `--primary-glow` | `#1A7AA3` | gradient stop |
| `--secondary` | `#E8F2F5` | `bg-secondary` |
| `--secondary-foreground` | `#0B4964` | `text-secondary-foreground` |
| `--muted` | `#EEF1F4` | `bg-muted` |
| `--muted-foreground` | `#667985` | `text-muted-foreground` |
| `--accent` | `#D99A17` (gold) | `bg-accent`, `text-accent` |
| `--accent-foreground` | `#08384E` | `text-accent-foreground` |
| `--destructive` | `#C53030` | `bg-destructive` |
| `--destructive-foreground` | `#FFFFFF` | — |
| `--success` | `#2F855A` | `bg-success` |
| `--success-foreground` | `#FFFFFF` | — |
| `--warning` | `#D99A17` (gold) | `bg-warning` |
| `--warning-foreground` | `#08384E` | — |
| `--border` | `#DDE6EA` | `border-border` |
| `--input` | `#DDE6EA` | `border-input` |
| `--ring` | `#105B7D` | `ring-ring` |
| `--sidebar` | `#08384E` | `bg-sidebar` |
| `--sidebar-foreground` | `#F7FAFC` | `text-sidebar-foreground` |
| `--sidebar-accent` | `#105B7D` | active nav item background |
| `--sidebar-accent-foreground` | `#FFFFFF` | active nav item text |
| `--sidebar-border` | `#0B4964` | sidebar dividers |

No dedicated `info` token — informational surfaces reuse `--secondary` (soft primary).
No `--chart-*` tokens are defined; charts (recharts) currently render with library defaults or are styled per-instance.

## Dark theme (`.dark` — oklch-based, not currently activated in the app shell)

The app runs light-only (no `.dark` class is applied), but the theme is defined
for future use. Values are stated in oklch:

```css
.dark {
  --background: oklch(0.18 0.025 245);
  --foreground: oklch(0.96 0.012 85);
  --surface / --card / --popover: oklch(0.22 0.030 245);
  --primary: oklch(0.70 0.12 220);          /* lightened teal */
  --primary-foreground: oklch(0.18 0.025 245);
  --primary-glow: oklch(0.78 0.11 215);
  --secondary: oklch(0.28 0.04 240);
  --muted: oklch(0.26 0.03 240);
  --muted-foreground: oklch(0.72 0.02 240);
  --accent: oklch(0.78 0.13 75);            /* gold, lightened */
  --accent-foreground: oklch(0.22 0.04 60);
  --destructive: oklch(0.68 0.20 25);
  --success: oklch(0.70 0.14 155);
  --warning: oklch(0.80 0.15 65);
  --border / --input: oklch(0.30 / 0.28 0.03 240);
  --ring: oklch(0.70 0.12 220);
  --sidebar: oklch(0.20 0.030 245);
  --sidebar-accent: oklch(0.28 0.04 240);
}
```

## Gradients & shadows

```css
--gradient-hero: linear-gradient(135deg, #08384E 0%, #0B4964 40%, #105B7D 100%);
--gradient-gold: linear-gradient(90deg,  #B87900 0%, #D99A17 50%, #B87900 100%);
--shadow-card:     0 1px 3px rgb(16 35 51 / 0.06), 0 8px 24px  rgb(16 35 51 / 0.08);
--shadow-elevated: 0 4px 16px rgb(16 35 51 / 0.10), 0 24px 48px rgb(16 35 51 / 0.12);
```

## Hard-coded colors found in components (need attention on transfer)

Only two locations reference brand vars directly instead of semantic tokens
(both consciously use USR palette; safe to transfer as-is once tokens exist):

- `src/components/ui/button.tsx` — hover states use `bg-[var(--usr-primary-dark)]`, `bg-[var(--usr-primary-soft)]`, borders use `border-[var(--usr-border)]`.
- `src/components/ui/badge.tsx` — same pattern for hover / outline borders.

No `#hex` literals or ad-hoc `bg-black`/`text-white` classes were introduced in shared UI primitives.
