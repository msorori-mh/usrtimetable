# USR — Typography

## Loading source
Google Fonts, loaded via `<link rel="stylesheet">` in `src/routes/__root.tsx`
(NOT via `@import` in CSS — Tailwind v4 / Lightning CSS requires network fonts
via `<link>`):

```
https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Tajawal:wght@500;700;800&display=swap
```

With preconnects to `https://fonts.googleapis.com` and `https://fonts.gstatic.com`.

## Families

| Role | Family | Fallbacks | Token |
|---|---|---|---|
| Body / UI (Arabic + Latin + digits) | **Cairo** | Tajawal, system-ui, sans-serif | `--font-sans` |
| Display / Headings (h1–h4) | **Tajawal** | Cairo, serif | `--font-display` |

Registered in `src/styles.css` `@theme inline` block:
```css
--font-sans: "Cairo", "Tajawal", system-ui, sans-serif;
--font-display: "Tajawal", "Cairo", serif;
```

## Weights actually used
- Cairo: 400, 500, 600, 700
- Tajawal: 500, 700, 800

## Applied rules (from `src/styles.css` `@layer base`)
```css
body    { font-family: var(--font-sans); font-feature-settings: "kern","liga","ss01"; -webkit-font-smoothing: antialiased; }
h1..h4  { font-family: var(--font-display); letter-spacing: -0.01em; }
html    { direction: rtl; }
```

Root element: `<html lang="ar" dir="rtl" data-theme="usr">`.

## Tailwind utilities available
- `font-sans` → Cairo stack
- `font-display` → Tajawal stack (used explicitly on brand/university titles)
- Weight utilities used across the app: `font-medium` (500), `font-semibold` (600), `font-bold` (700), `font-extrabold` (800)
