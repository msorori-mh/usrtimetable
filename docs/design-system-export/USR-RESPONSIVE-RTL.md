# USR — RTL, Layout & Responsive Behavior

## Direction
- Root: `<html lang="ar" dir="rtl" data-theme="usr">` (see `src/routes/__root.tsx`).
- Also enforced globally in `src/styles.css` base layer: `html { direction: rtl; }`.
- All layouts assume RTL: flex rows flow right→left, icons sit at the item start (visually right), Arabic text is default.
- Latin fragments and numerics render inside the same Cairo/Tajawal stack — no explicit LTR wrappers except inside tabular data where needed.

## Breakpoints (Tailwind v4 defaults, unchanged)
`sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`.

## App shell (from `app-layout.tsx`)
- Two-column desktop: fixed sidebar on the right (RTL "start"), main content on the left.
- Sidebar width: ~`w-64` (16rem).
- Header height: ~`h-14` (`3.5rem`), sticky, `bg-card border-b`.
- Main content padded `p-6` on desktop, tightened to `p-4` on mobile via responsive utilities.
- Mobile: sidebar collapses into a `Sheet` drawer opened by a menu button in the header.

## Page containers
- Standard page wrapper: `mx-auto max-w-3xl` for forms/settings; `max-w-6xl` or full-width for tables/reports.
- Page header pattern: `usr-page-header` = icon chip + title + subtitle, bottom-bordered.
- Card grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` for stat/summary cards.

## Spacing scale (observed)
- Section vertical gap: `space-y-6` / `gap-6`.
- Card padding: `p-6` (header/content), `p-4` for compact cards.
- Input height: `h-9`. Button height: `h-9` default, `h-8` sm, `h-10` lg.
- Radius scale (from `@theme`): `--radius: 0.625rem` → `sm 0.375`, `md 0.5`, `lg 0.625`, `xl 0.875`, `2xl 1.125rem`.

## Focus / hover / disabled
- Focus ring: `focus-visible:ring-2 ring-ring ring-offset-2` (ring = primary).
- Hover on primary surfaces: darkens to `--usr-primary-dark`; on light surfaces: `--usr-primary-soft` background.
- Disabled: `opacity-50 pointer-events-none`.

## Print
Extensive `@media print` rules in `src/styles.css` for reports:
- `@page { margin: 1.2cm 1.5cm; }`, forces `background:white; color:black; print-color-adjust:exact`.
- Hides `aside, .report-no-print, [data-sonner-toaster]`.
- Table borders normalized, `thead` repeated per page, `tr` avoids page breaks.

## What is scheduler-specific and should NOT be lifted verbatim
- The `.report-timetable-grid` absolute-positioning rules.
- The internal main gradients used inside the scheduler dashboard header (`usr-dashboard-header` is generic, but the KPI arrangement inside it is scheduler content).
