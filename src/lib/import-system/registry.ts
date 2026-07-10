import type {
  CanonicalImportDataType,
  ImportDefinition,
  ImportDefinitionSummary,
  ImportReleasePhase,
} from "./contracts";
import { IMPORT_DEFINITIONS } from "./definitions/index";

function toSummary(def: ImportDefinition): ImportDefinitionSummary {
  return {
    dataType: def.dataType,
    templateId: def.templateIdentity.templateId,
    labels: def.labels,
    category: def.category,
    releasePhase: def.releasePhase,
    availability: def.availability,
    importModePolicy: def.importModePolicy,
    dependencyCount: def.dependencies.length,
    legacyImportOperational: def.capabilities.legacyImportOperational,
  };
}

export function buildImportRegistry(): Readonly<Record<CanonicalImportDataType, ImportDefinition>> {
  return Object.fromEntries(IMPORT_DEFINITIONS.map((def) => [def.dataType, def])) as Record<
    CanonicalImportDataType,
    ImportDefinition
  >;
}

export function getImportDefinition(dataType: CanonicalImportDataType): ImportDefinition {
  const registry = buildImportRegistry();
  const def = registry[dataType];
  if (!def) {
    throw new Error(`Import definition not found: ${dataType}`);
  }
  return def;
}

export function listImportDefinitions(): readonly ImportDefinitionSummary[] {
  return IMPORT_DEFINITIONS.map(toSummary);
}

export function listImportDefinitionsByPhase(
  phase: ImportReleasePhase,
): readonly ImportDefinitionSummary[] {
  return IMPORT_DEFINITIONS.filter((def) => def.releasePhase === phase).map(toSummary);
}
