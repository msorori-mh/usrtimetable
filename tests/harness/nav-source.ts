/**
 * Shared helper for navigation harnesses.
 *
 * Since SOURCE_ONLY_ADMIN_UX_INFORMATION_ARCHITECTURE_02 the navigation catalog
 * lives in src/lib/admin-nav.ts while src/components/app-layout.tsx renders it.
 * "Primary navigation source" therefore means: the layout + the catalog WITHOUT
 * the legacy/diagnostic list (which is intentionally excluded from primary nav).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function readPrimaryNavigationSource(root: string): string {
  const layout = readFileSync(path.join(root, "src/components/app-layout.tsx"), "utf8");
  const catalog = readFileSync(path.join(root, "src/lib/admin-nav.ts"), "utf8");
  const legacyStart = catalog.indexOf("export const LEGACY_ADMIN_PAGES");
  const legacyEnd = catalog.indexOf("export interface CoreStep");
  const primaryCatalog =
    legacyStart >= 0 && legacyEnd > legacyStart
      ? catalog.slice(0, legacyStart) + catalog.slice(legacyEnd)
      : catalog;
  return `${layout}\n${primaryCatalog}`;
}
