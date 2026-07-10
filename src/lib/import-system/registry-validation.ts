import type { CanonicalImportDataType, ImportDefinition } from "./contracts";
import { CANONICAL_IMPORT_DATA_TYPES, isCanonicalImportDataType } from "./canonical-types";

const VALID_CATEGORIES = new Set(["foundational", "academic_plan", "resources", "scheduling"]);

const VALID_MODES = new Set(["CREATE_ONLY", "UPDATE_ONLY", "UPSERT", "REPLACE_SCOPED"]);

const VALID_PHASES = new Set(["R1", "R2", "R3", "R4", "R5"]);

const VALID_AVAILABILITY = new Set(["available", "coming_soon", "deprecated", "internal"]);

const R1_TYPES = new Set<CanonicalImportDataType>([
  "academic_terms",
  "study_plan_rows",
  "course_programs",
  "instructors",
  "rooms",
  "daily_breaks",
  "course_offerings",
  "teaching_assignments",
  "section_groups",
]);

const COMING_SOON_TYPES = new Set<CanonicalImportDataType>([
  "departments",
  "academic_programs",
  "sections",
  "instructor_availability",
  "room_availability",
  "time_slot_templates",
]);

export class RegistryValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: string[]) {
    super(`Registry validation failed (${errors.length} error(s)):\n${errors.join("\n")}`);
    this.name = "RegistryValidationError";
    this.errors = errors;
  }
}

function topologicalSort(
  registry: Record<CanonicalImportDataType, ImportDefinition>,
): CanonicalImportDataType[] | null {
  const inDegree = new Map<CanonicalImportDataType, number>();
  const adj = new Map<CanonicalImportDataType, CanonicalImportDataType[]>();

  for (const type of CANONICAL_IMPORT_DATA_TYPES) {
    inDegree.set(type, 0);
    adj.set(type, []);
  }

  for (const def of Object.values(registry)) {
    for (const dep of def.dependencies) {
      const list = adj.get(dep.dataType);
      if (list) {
        list.push(def.dataType);
      }
      inDegree.set(def.dataType, (inDegree.get(def.dataType) ?? 0) + 1);
    }
  }

  const queue: CanonicalImportDataType[] = [];
  for (const type of CANONICAL_IMPORT_DATA_TYPES) {
    if ((inDegree.get(type) ?? 0) === 0) {
      queue.push(type);
    }
  }

  const sorted: CanonicalImportDataType[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const next of adj.get(current) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
      }
    }
  }

  return sorted.length === CANONICAL_IMPORT_DATA_TYPES.length ? sorted : null;
}

export function assertRegistryIntegrity(
  registry: Record<CanonicalImportDataType, ImportDefinition>,
): void {
  const errors: string[] = [];
  const entries = Object.entries(registry) as [CanonicalImportDataType, ImportDefinition][];

  // V1: Registry has exactly 15 entries
  if (entries.length !== 15) {
    errors.push(`REGISTRY_COUNT: expected 15 entries, got ${entries.length}`);
  }

  // V2: Every CANONICAL_IMPORT_DATA_TYPES member has definition
  for (const type of CANONICAL_IMPORT_DATA_TYPES) {
    if (!(type in registry)) {
      errors.push(`REGISTRY_MISSING_TYPE: missing definition for ${type}`);
    }
  }

  // V3: No extra keys beyond canonical union
  for (const key of Object.keys(registry)) {
    if (!isCanonicalImportDataType(key)) {
      errors.push(`REGISTRY_UNKNOWN_TYPE: unknown key ${key}`);
    }
  }

  // V24: No labs dataType
  if ("labs" in registry) {
    errors.push("LABS_SPLIT_REJECTED: labs dataType must not exist");
  }

  const dataTypes = new Set<string>();
  const templateIds = new Set<string>();
  const labelArSet = new Map<string, CanonicalImportDataType>();

  for (const [key, def] of entries) {
    // V4: dataType unique
    if (dataTypes.has(def.dataType)) {
      errors.push(`DUPLICATE_DATA_TYPE: ${def.dataType}`);
    }
    dataTypes.add(def.dataType);

    if (def.dataType !== key) {
      errors.push(`DUPLICATE_DATA_TYPE: registry key ${key} !== dataType ${def.dataType}`);
    }

    // V5: templateId unique
    const tid = def.templateIdentity.templateId;
    if (templateIds.has(tid)) {
      errors.push(`DUPLICATE_TEMPLATE_ID: ${tid}`);
    }
    templateIds.add(tid);

    // V6: templateId === dataType in V1
    if (tid !== def.dataType) {
      errors.push(`TEMPLATE_ID_MISMATCH: ${def.dataType} has templateId ${tid}`);
    }

    // V7: All dependencies reference known canonical types
    for (const dep of def.dependencies) {
      if (!isCanonicalImportDataType(dep.dataType)) {
        errors.push(`UNKNOWN_DEPENDENCY: ${def.dataType} → ${dep.dataType}`);
      }
    }

    // V8: No self-dependency
    if (def.dependencies.some((d) => d.dataType === def.dataType)) {
      errors.push(`SELF_DEPENDENCY: ${def.dataType}`);
    }

    // V10: labels non-empty
    if (!def.labels.ar.trim()) {
      errors.push(`MISSING_LABEL: ${def.dataType} labels.ar empty`);
    }
    if (!def.labels.en.trim()) {
      errors.push(`MISSING_LABEL: ${def.dataType} labels.en empty`);
    }

    // V11: category valid
    if (!VALID_CATEGORIES.has(def.category)) {
      errors.push(`INVALID_CATEGORY: ${def.dataType} → ${def.category}`);
    }

    // V12: targetEntity non-empty
    const targets = Array.isArray(def.targetEntity) ? def.targetEntity : [def.targetEntity];
    if (targets.length === 0 || targets.some((t) => !String(t).trim())) {
      errors.push(`MISSING_TARGET: ${def.dataType}`);
    }

    // V13: importModePolicy valid
    if (!VALID_MODES.has(def.importModePolicy)) {
      errors.push(`INVALID_MODE: ${def.dataType} → ${def.importModePolicy}`);
    }

    // V14: releasePhase valid
    if (!VALID_PHASES.has(def.releasePhase)) {
      errors.push(`INVALID_PHASE: ${def.dataType} → ${def.releasePhase}`);
    }

    // V15: availability valid
    if (!VALID_AVAILABILITY.has(def.availability)) {
      errors.push(`INVALID_AVAILABILITY: ${def.dataType} → ${def.availability}`);
    }

    // V16: naturalKey.summary non-empty
    if (!def.naturalKey.summary.trim()) {
      errors.push(`MISSING_NATURAL_KEY: ${def.dataType}`);
    }

    // V17: R1 available have legacyImportOperational: true
    if (R1_TYPES.has(def.dataType) && !def.capabilities.legacyImportOperational) {
      errors.push(`R1_LEGACY_MAPPING: ${def.dataType} must have legacyImportOperational: true`);
    }

    // V18: Coming Soon have legacyImportOperational: false
    if (COMING_SOON_TYPES.has(def.dataType) && def.capabilities.legacyImportOperational) {
      errors.push(`COMING_SOON_LEGACY: ${def.dataType} must have legacyImportOperational: false`);
    }

    // V19: Coming Soon have all canonical* flags false
    if (COMING_SOON_TYPES.has(def.dataType)) {
      const caps = def.capabilities;
      if (
        caps.canonicalTemplate ||
        caps.canonicalPreflight ||
        caps.canonicalPreview ||
        caps.canonicalExecution
      ) {
        errors.push(`COMING_SOON_CANONICAL: ${def.dataType} canonical flags must be false`);
      }
    }

    // V20: All types have all canonical* flags false in PR1
    const caps = def.capabilities;
    if (
      caps.canonicalTemplate ||
      caps.canonicalPreflight ||
      caps.canonicalPreview ||
      caps.canonicalExecution
    ) {
      errors.push(`PR1_CANONICAL_DISABLED: ${def.dataType} canonical flags must be false in PR1`);
    }

    // V21: deprecatedAliases don't duplicate another dataType
    if (def.deprecationMetadata?.deprecatedAliases) {
      for (const alias of def.deprecationMetadata.deprecatedAliases) {
        if (isCanonicalImportDataType(alias) && alias !== def.dataType) {
          errors.push(`ALIAS_COLLISION: ${def.dataType} alias ${alias} collides with dataType`);
        }
      }
    }

    // V22: duplicate labels.ar (warn only — collected but not blocking)
    const existing = labelArSet.get(def.labels.ar);
    if (existing && existing !== def.dataType) {
      // Non-blocking warning — not added to errors per validation plan
    } else {
      labelArSet.set(def.labels.ar, def.dataType);
    }

    // V23: study_plan_rows lists both legacy keys
    if (def.dataType === "study_plan_rows") {
      const keys = def.deprecationMetadata?.legacyEntityKeys ?? [];
      if (!keys.includes("study_plan_courses") || !keys.includes("full_study_plan")) {
        errors.push(
          "STUDY_PLAN_ALIASES: study_plan_rows must list study_plan_courses and full_study_plan",
        );
      }
    }

    // V25: maxRows > 0 and ≤ 10000
    if (def.maxRows <= 0 || def.maxRows > 10000) {
      errors.push(`INVALID_MAX_ROWS: ${def.dataType} maxRows=${def.maxRows}`);
    }
  }

  // V9: Dependency graph acyclic
  const sorted = topologicalSort(registry);
  if (!sorted) {
    errors.push("DEPENDENCY_CYCLE: dependency graph contains a cycle");
  }

  if (errors.length > 0) {
    throw new RegistryValidationError(errors);
  }
}
