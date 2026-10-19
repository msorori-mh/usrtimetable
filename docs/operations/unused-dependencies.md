# Unused npm dependencies after M-18 (unused shadcn/ui components removed)

> **Done (2026-10-19):** the 19 packages below were removed from `package.json` and `bun.lock`
> was regenerated on the public registry (fresh install, frozen install, build, `tsc` and
> `bun audit` all passed in CI). This page is kept as the record of why they went.

Audit finding M-18 removed shadcn/ui wrapper files under `src/components/ui/` that had no
importer anywhere in `src/` or `tests/`:

`alert`, `aspect-ratio`, `avatar`, `breadcrumb`, `calendar`, `carousel`, `context-menu`,
`drawer`, `form`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`,
`radio-group`, `resizable`, `scroll-area`, `sidebar`, `slider`, `toggle-group`, `toggle`
(`toggle` was only imported by `toggle-group`).

The remediation environment has no npm registry access, so `package.json` and `bun.lock`
were **not** changed. The packages below now have zero imports in `src/`, `tests/` and
`scripts/` (checked with `grep -rlE "[\"']<package>[\"'/]" src tests scripts`) and can be
removed where the registry is reachable.

| Package | Was used only by |
| --- | --- |
| `@radix-ui/react-aspect-ratio` | `ui/aspect-ratio.tsx` |
| `@radix-ui/react-avatar` | `ui/avatar.tsx` |
| `@radix-ui/react-context-menu` | `ui/context-menu.tsx` |
| `@radix-ui/react-hover-card` | `ui/hover-card.tsx` |
| `@radix-ui/react-menubar` | `ui/menubar.tsx` |
| `@radix-ui/react-navigation-menu` | `ui/navigation-menu.tsx` |
| `@radix-ui/react-radio-group` | `ui/radio-group.tsx` |
| `@radix-ui/react-scroll-area` | `ui/scroll-area.tsx` |
| `@radix-ui/react-slider` | `ui/slider.tsx` |
| `@radix-ui/react-toggle` | `ui/toggle.tsx` |
| `@radix-ui/react-toggle-group` | `ui/toggle-group.tsx` |
| `embla-carousel-react` | `ui/carousel.tsx` |
| `input-otp` | `ui/input-otp.tsx` |
| `react-day-picker` | `ui/calendar.tsx` |
| `react-hook-form` | `ui/form.tsx` |
| `@hookform/resolvers` | nothing (no import before or after) |
| `react-resizable-panels` | `ui/resizable.tsx` |
| `vaul` | `ui/drawer.tsx` |
| `date-fns` | nothing (no import before or after) |

Still used — keep: `@radix-ui/react-label` (`ui/label.tsx`), `@radix-ui/react-slot`
(`ui/button.tsx`), `class-variance-authority`, `cmdk` (`ui/command.tsx`, used by
`components/teaching-assignments/instructor-combobox.tsx`), `recharts` (now loaded lazily
by the rooms analytics/decisions panels).

`src/hooks/use-mobile.tsx` was only imported by `ui/sidebar.tsx`; it is now unused too
(left in place because it is outside the M-18 file set — delete it in the same change).

## Command (run where the npm registry is reachable)

```sh
bun remove @radix-ui/react-aspect-ratio @radix-ui/react-avatar @radix-ui/react-context-menu \
  @radix-ui/react-hover-card @radix-ui/react-menubar @radix-ui/react-navigation-menu \
  @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-slider \
  @radix-ui/react-toggle @radix-ui/react-toggle-group embla-carousel-react input-otp \
  react-day-picker react-hook-form @hookform/resolvers react-resizable-panels vaul date-fns
```

Before committing the result, re-run the check (a new import may have appeared since):

```sh
for p in @radix-ui/react-aspect-ratio @radix-ui/react-avatar @radix-ui/react-context-menu \
  @radix-ui/react-hover-card @radix-ui/react-menubar @radix-ui/react-navigation-menu \
  @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-slider \
  @radix-ui/react-toggle @radix-ui/react-toggle-group embla-carousel-react input-otp \
  react-day-picker react-hook-form @hookform/resolvers react-resizable-panels vaul date-fns; do
  grep -rlE "[\"']$p[\"'/]" src tests scripts && echo "STILL USED: $p"
done
```

then `bun run build` and the test suite, and commit `package.json` with `bun.lock`.
