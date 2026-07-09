# USR — Visual Assets Inventory

## Logos / brand
| Path | Purpose | Portable to portal? |
|---|---|---|
| `public/branding/usr-university-logo.png` | Official university logo, referenced as `USR_UNIVERSITY_LOGO_SRC` in `src/lib/branding/usr.ts` and rendered by `src/components/branding/usr-brand-mark.tsx`. | **Yes** — reuse identical file and constant. |

## Favicon / PWA
- No custom favicon or `site.webmanifest` shipped in `public/` (only `public/branding/`). Portal should add its own once brand direction is confirmed.
- No PWA icons, no `manifest.json`, no `apple-touch-icon`.

## Background images / decorative patterns
- None. Visual depth comes from CSS gradients (`--gradient-hero`, `--gradient-gold`) and shadows (`--shadow-card`, `--shadow-elevated`), not from raster assets.

## SVG assets
- No project-owned SVGs in `public/`. All in-app iconography comes from `lucide-react` at runtime.

## Brand strings (Arabic — from `src/lib/branding/usr.ts`)
- `USR_UNIVERSITY_NAME_AR` = "جامعة إقليم سبأ"
- `USR_PLATFORM_NAME_AR` = "منصة إدارة الجداول الجامعية" *(scheduler-specific — replace on portal)*
- `USR_COLLEGE_NAME_FALLBACK_AR` = "كلية تكنولوجيا المعلومات وعلوم الحاسوب"
- `USR_TAGLINE_AR` = "جامعة رائدة ترسّخ التميز الأكاديمي وتستشرف المستقبل"
- `USR_PLATFORM_DESC_AR`, `USR_ACCESS_NOTICE_AR`, `USR_AUTH_NOTICE_AR`, `USR_FOOTER_AR`

Only `USR_UNIVERSITY_NAME_AR`, `USR_TAGLINE_AR`, and the logo/path constants
are truly institutional. The rest are scheduler-app copy.

## Transfer note
No binary assets need to be copied for the portal to look on-brand. Only
`public/branding/usr-university-logo.png` needs to be duplicated (or served
from a shared brand CDN when available).
