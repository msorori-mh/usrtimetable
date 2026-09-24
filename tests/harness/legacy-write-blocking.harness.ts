/**
 * legacy-write-blocking.harness.ts — A1.3a static verification (source-only).
 *
 * Verifies, from source only (no DB access, no migration apply):
 *  1) The /sections Legacy page has no active write control: create/edit/delete
 *     UI is gated behind LEGACY_SECTIONS_WRITE_BLOCKED, and both historical
 *     mutations self-reject with a clear blocked message.
 *  2) No active client DML (insert/update/upsert/delete) against Legacy tables
 *     (sections, course_offering_sections, section_groups, section_group_members,
 *     teaching_assignments V1) anywhere in src outside the blocked Legacy page.
 *  3) LEGACY_ONLY import templates remain registered but hidden from the
 *     operational UI, and the client commit path refuses LEGACY_ONLY import jobs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};
const squash = (value: string) => value.replace(/\s+/g, " ");

// ---------- 1) /sections page is read-only ----------
const sections = read("src/routes/_authenticated/sections.tsx");

assert(
  sections.includes("const LEGACY_SECTIONS_WRITE_BLOCKED = true;"),
  "sections.tsx declares LEGACY_SECTIONS_WRITE_BLOCKED = true",
);
assert(
  sections.includes("LEGACY_SECTION_WRITE_BLOCKED"),
  "sections.tsx defines the LEGACY_SECTION_WRITE_BLOCKED message",
);
const mutationGuards =
  sections.split("if (LEGACY_SECTIONS_WRITE_BLOCKED) throw new Error(").length - 1;
assert(mutationGuards === 2, "save + delete mutations both self-reject while writes are blocked");
assert(
  !sections.includes("{canManage && ("),
  "no active canManage write control remains in sections.tsx",
);
const gatedControls =
  sections.split("{canManage && !LEGACY_SECTIONS_WRITE_BLOCKED && (").length - 1;
assert(gatedControls === 2, "create dialog and row actions are both gated behind the block flag");
assert(
  sections.includes('meta: [{ title: "Legacy — للعرض التاريخي" }]'),
  "Legacy historical title retained",
);
assert(
  sections.includes('.from("sections")') && sections.includes(".select("),
  "historical SELECT view of sections retained (read-only)",
);
assert(sections.includes("A1.3a"), "page banner documents the A1.3a write block");

// ---------- 2) no active Legacy-table DML in modern UI/source paths ----------
const LEGACY_TABLES = [
  "sections",
  "course_offering_sections",
  "section_groups",
  "section_group_members",
  "teaching_assignments",
];
const dmlPattern = (table: string) =>
  new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)\\s*\\.(insert|update|upsert|delete)\\s*\\(`);

// Files verified separately above (blocked historical code) or generated types.
const SKIP_FILES = new Set([
  "src/routes/_authenticated/sections.tsx",
  "src/integrations/supabase/types.ts",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.slice(root.length + 1).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield rel;
  }
}

const offenders: string[] = [];
for (const rel of walk(resolve(root, "src"))) {
  const body = squash(read(rel));
  for (const table of LEGACY_TABLES) {
    if (dmlPattern(table).test(body)) offenders.push(`${rel} -> ${table}`);
  }
}
assert(
  offenders.length === 0,
  `no active client DML against Legacy tables outside the blocked page; offenders: ${offenders.join(", ")}`,
);

// ---------- 3) LEGACY_ONLY import stays registered, hidden, and uncommittable ----------
const registry = read("src/lib/excel-import/registry.ts");
for (const entity of ["sections", "course_offerings", "teaching_assignments", "section_groups"]) {
  assert(
    registry.includes(`"${entity}",`),
    `LEGACY_ONLY entity ${entity} remains registered for compatibility`,
  );
}
assert(
  registry.split('classification: "LEGACY_ONLY"').length - 1 === 4,
  "registry keeps exactly 4 LEGACY_ONLY classifications",
);
assert(
  registry.split("showInImportUi: false").length - 1 === 4,
  "all 4 LEGACY_ONLY entities stay hidden from the import UI",
);

const dataTemplates = read("src/routes/_authenticated/data-templates.tsx");
assert(
  dataTemplates.includes('to: "/data-onboarding"') &&
    read("src/lib/data-onboarding/preparation.ts").includes("listImportUiEntities"),
  "guide redirects to the preparation registry, which excludes legacy imports",
);

const importUi = read("src/components/data-onboarding/import-workspace.tsx");
assert(
  importUi.includes("listImportUiEntities"),
  "import UI sources its entity list from listImportUiEntities (ACTIVE_NEW_FLOW only)",
);
assert(
  !importUi.includes('value: "sections"') && !importUi.includes('"section_groups"'),
  "import UI exposes no Legacy entity option",
);

const commit = read("src/lib/excel-import/commit.ts");
assert(
  commit.includes("import_legacy_entity_blocked") &&
    commit.includes("LEGACY_IMPORT_COMMIT_BLOCKED"),
  "client commit refuses LEGACY_ONLY import jobs (A1.3a guard)",
);

console.log("legacy-write-blocking.harness.ts: PASS");
