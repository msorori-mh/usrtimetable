/**
 * DATA-IMPORT-SYSTEM-FOUNDATION-IMPLEMENTATION-EXEC-01 harness.
 * Validates canonical import registry metadata — no DB, no runtime wiring.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_IMPORT_DATA_TYPES,
  buildImportRegistry,
  canCanonicalExecute,
  getImportDefinition,
  isCanonicalImportDataType,
  listImportDefinitionsByPhase,
} from "@/lib/import-system";
import type { CanonicalImportDataType } from "@/lib/import-system";
import { assertRegistryIntegrity } from "@/lib/import-system/registry-validation";

const R1_TYPES: readonly CanonicalImportDataType[] = [
  "academic_terms",
  "study_plan_rows",
  "course_programs",
  "instructors",
  "rooms",
  "daily_breaks",
  "course_offerings",
  "teaching_assignments",
  "section_groups",
];

const COMING_SOON_TYPES: readonly CanonicalImportDataType[] = [
  "departments",
  "academic_programs",
  "sections",
  "instructor_availability",
  "room_availability",
  "time_slot_templates",
];

const EXCLUDED_ENTITY_KEYS = [
  "courses",
  "colleges",
  "college",
  "labs",
  "programs",
  "study_plan_courses",
  "full_study_plan",
] as const;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function topologicalSort(
  registry: ReturnType<typeof buildImportRegistry>,
): CanonicalImportDataType[] | null {
  const inDegree = new Map<CanonicalImportDataType, number>();
  const adj = new Map<CanonicalImportDataType, CanonicalImportDataType[]>();

  for (const type of CANONICAL_IMPORT_DATA_TYPES) {
    inDegree.set(type, 0);
    adj.set(type, []);
  }

  for (const def of Object.values(registry)) {
    for (const dep of def.dependencies) {
      adj.get(dep.dataType)!.push(def.dataType);
      inDegree.set(def.dataType, (inDegree.get(def.dataType) ?? 0) + 1);
    }
  }

  const queue: CanonicalImportDataType[] = [];
  for (const type of CANONICAL_IMPORT_DATA_TYPES) {
    if ((inDegree.get(type) ?? 0) === 0) queue.push(type);
  }

  const sorted: CanonicalImportDataType[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const next of adj.get(current) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  return sorted.length === CANONICAL_IMPORT_DATA_TYPES.length ? sorted : null;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const tests: Array<{ id: number; name: string; run: () => void }> = [];

tests.push({
  id: 1,
  name: "Registry count === 15",
  run: () => {
    const registry = buildImportRegistry();
    assert(Object.keys(registry).length === 15, `expected 15, got ${Object.keys(registry).length}`);
  },
});

tests.push({
  id: 2,
  name: "dataType uniqueness",
  run: () => {
    const registry = buildImportRegistry();
    const types = Object.values(registry).map((d) => d.dataType);
    assert(new Set(types).size === 15, "duplicate dataType found");
  },
});

tests.push({
  id: 3,
  name: "templateId uniqueness",
  run: () => {
    const registry = buildImportRegistry();
    const ids = Object.values(registry).map((d) => d.templateIdentity.templateId);
    assert(new Set(ids).size === 15, "duplicate templateId found");
  },
});

tests.push({
  id: 4,
  name: "All dependencies exist in canonical union",
  run: () => {
    const registry = buildImportRegistry();
    for (const def of Object.values(registry)) {
      for (const dep of def.dependencies) {
        assert(
          isCanonicalImportDataType(dep.dataType),
          `${def.dataType} has unknown dependency ${dep.dataType}`,
        );
      }
    }
  },
});

tests.push({
  id: 5,
  name: "No dependency cycles",
  run: () => {
    const registry = buildImportRegistry();
    assert(topologicalSort(registry) !== null, "dependency cycle detected");
  },
});

tests.push({
  id: 6,
  name: "R1 set exact (9 types)",
  run: () => {
    const registry = buildImportRegistry();
    const r1InRegistry = Object.values(registry)
      .filter((d) => d.releasePhase === "R1")
      .map((d) => d.dataType)
      .sort();
    const expected = [...R1_TYPES].sort();
    assert(
      JSON.stringify(r1InRegistry) === JSON.stringify(expected),
      `R1 mismatch: ${JSON.stringify(r1InRegistry)} vs ${JSON.stringify(expected)}`,
    );
  },
});

tests.push({
  id: 7,
  name: "Coming Soon not canonical-executable",
  run: () => {
    for (const type of COMING_SOON_TYPES) {
      const def = getImportDefinition(type);
      assert(!canCanonicalExecute(def), `${type} should not be canonical-executable`);
    }
  },
});

tests.push({
  id: 8,
  name: "B/C/D/E entities absent from registry keys",
  run: () => {
    const registry = buildImportRegistry();
    for (const key of EXCLUDED_ENTITY_KEYS) {
      assert(!(key in registry), `${key} must not be a registry key`);
      assert(!isCanonicalImportDataType(key), `${key} must not be canonical`);
    }
  },
});

tests.push({
  id: 9,
  name: "rooms appears exactly once",
  run: () => {
    const registry = buildImportRegistry();
    const roomDefs = Object.values(registry).filter((d) => d.dataType === "rooms");
    assert(roomDefs.length === 1, `expected 1 rooms entry, got ${roomDefs.length}`);
  },
});

tests.push({
  id: 10,
  name: "No labs dataType",
  run: () => {
    const registry = buildImportRegistry();
    assert(!("labs" in registry), "labs must not exist");
    assert(!isCanonicalImportDataType("labs"), "labs must not be canonical");
  },
});

tests.push({
  id: 11,
  name: "academic_terms Arabic label",
  run: () => {
    const def = getImportDefinition("academic_terms");
    assert(def.labels.ar === "الفترات الأكاديمية", `got ${def.labels.ar}`);
  },
});

tests.push({
  id: 12,
  name: "sections Arabic label",
  run: () => {
    const def = getImportDefinition("sections");
    assert(def.labels.ar === "الشعب الدراسية", `got ${def.labels.ar}`);
  },
});

tests.push({
  id: 13,
  name: "study_plan_rows legacy entity keys",
  run: () => {
    const def = getImportDefinition("study_plan_rows");
    const keys = def.deprecationMetadata?.legacyEntityKeys ?? [];
    assert(keys.includes("study_plan_courses"), "missing study_plan_courses");
    assert(keys.includes("full_study_plan"), "missing full_study_plan");
  },
});

tests.push({
  id: 14,
  name: "No supabase imports in import-system module",
  run: () => {
    const moduleDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/lib/import-system",
    );
    const files = collectTsFiles(moduleDir);
    const forbidden = ["@/integrations/supabase", "integrations/supabase"];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        assert(
          !content.includes(pattern),
          `${path.relative(moduleDir, file)} imports supabase (${pattern})`,
        );
      }
    }
  },
});

tests.push({
  id: 15,
  name: "PR1 canonical capability flags false for all 15",
  run: () => {
    const registry = buildImportRegistry();
    for (const def of Object.values(registry)) {
      const c = def.capabilities;
      assert(!c.canonicalTemplate, `${def.dataType} canonicalTemplate`);
      assert(!c.canonicalPreflight, `${def.dataType} canonicalPreflight`);
      assert(!c.canonicalPreview, `${def.dataType} canonicalPreview`);
      assert(!c.canonicalExecution, `${def.dataType} canonicalExecution`);
    }
  },
});

tests.push({
  id: 16,
  name: "R1 legacyImportOperational true (9 types)",
  run: () => {
    for (const type of R1_TYPES) {
      const def = getImportDefinition(type);
      assert(
        def.capabilities.legacyImportOperational,
        `${type} must have legacyImportOperational: true`,
      );
    }
  },
});

tests.push({
  id: 17,
  name: "Release phase counts R1=9 R2=3 R3=3",
  run: () => {
    assert(listImportDefinitionsByPhase("R1").length === 9, "R1 count");
    assert(listImportDefinitionsByPhase("R2").length === 3, "R2 count");
    assert(listImportDefinitionsByPhase("R3").length === 3, "R3 count");
  },
});

tests.push({
  id: 18,
  name: "assertRegistryIntegrity passes",
  run: () => {
    assertRegistryIntegrity(buildImportRegistry());
  },
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const t of tests) {
  try {
    t.run();
    passed++;
    console.log(`PASS Test ${t.id}: ${t.name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`Test ${t.id}: ${msg}`);
    console.error(`FAIL Test ${t.id}: ${t.name}: ${msg}`);
  }
}

const summary = {
  phase: "DATA-IMPORT-SYSTEM-FOUNDATION-IMPLEMENTATION-EXEC-01",
  passed,
  failed,
  total: tests.length,
  failures,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);
