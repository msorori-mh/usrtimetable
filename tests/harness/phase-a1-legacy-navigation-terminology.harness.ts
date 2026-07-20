import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const layout = read("src/components/app-layout.tsx");
const sections = read("src/routes/_authenticated/sections.tsx");
const templates = read("src/routes/_authenticated/data-templates.tsx");
const registry = read("src/lib/excel-import/registry.ts");
const cohorts = read("src/routes/_authenticated/academic-cohorts.tsx");
const groups = read("src/routes/_authenticated/delivery-groups.tsx");
const assignments = read("src/routes/_authenticated/teaching-assignments.tsx");

assert.equal(
  /to:\s*"\/sections"/.test(layout),
  false,
  "Sections must not appear in New Flow navigation",
);
assert.ok(sections.includes("Legacy — للعرض التاريخي"), "deep route must be clearly marked Legacy");
assert.ok(
  templates.includes('CATALOG.filter((t) => t.classification !== "LEGACY_ONLY")'),
  "active catalog must exclude Legacy templates",
);
for (const entity of ["sections", "section_groups", "course_offerings", "teaching_assignments"]) {
  assert.ok(
    registry.includes(`${entity}: {`) || registry.includes(`"${entity}"`),
    `${entity} retained in compatibility registry`,
  );
}
for (const term of [
  "الدفعات الدراسية",
  "المقررات الاختيارية المعتمدة",
  "مجموعات المحاضرات والمعامل",
  "الإسناد التدريسي",
  "الخطوة التالية",
]) {
  assert.ok(
    `${layout}${cohorts}${groups}${assignments}`.includes(term),
    `missing official term: ${term}`,
  );
}
assert.ok(
  layout.includes("أيام وفترات الدوام"),
  "official working-days terminology must be in navigation",
);
assert.ok(assignments.includes('to="/schedule-builder"'), "workflow must end at Builder V2");

// Negative assertions (AUTO_SAFE): Legacy terminology residues must not regress
// in the New Flow pages touched by this phase. Whitespace is squashed so that
// phrases split across JSX line breaks are still caught.
// Note: the sixth legacy term "المجموعات المشتركة للمحاضرات" is intentionally
// NOT covered here — deferred to Phase A2 per leadership decision D-005.
const squashWs = (s: string) => s.replace(/\s+/g, " ");
const newFlowPages: Array<[string, string]> = [
  ["academic-cohorts.tsx", cohorts],
  ["delivery-groups.tsx", groups],
  ["teaching-assignments.tsx", assignments],
];
for (const [pageName, pageContent] of newFlowPages) {
  const flat = squashWs(pageContent);
  for (const legacy of [
    "مجموعات التدريس",
    "مجموعة تدريس",
    "الدفعات الأكاديمية",
    "طروحات توافقية",
    "الطروحات التوافقية",
  ]) {
    assert.equal(
      flat.includes(legacy),
      false,
      `${pageName} must not contain legacy term: ${legacy}`,
    );
  }
}

console.log(JSON.stringify({ harness: "phase-a1-legacy-navigation-terminology", status: "pass" }));
