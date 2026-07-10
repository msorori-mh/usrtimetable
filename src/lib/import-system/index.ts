export type {
  CanonicalImportDataType,
  CollegePermission,
  ImportAvailability,
  ImportCapabilityFlags,
  ImportCategory,
  ImportDefinition,
  ImportDefinitionSummary,
  ImportDependency,
  ImportDeprecationMetadata,
  ImportLabels,
  ImportModePolicy,
  ImportPermissions,
  ImportReleasePhase,
  ImportRole,
  ImportTemplateIdentity,
  NaturalKeyDefinition,
  NaturalKeyPart,
} from "./contracts";

export { PR1_CAPABILITY_DEFAULTS } from "./contracts";

export { CANONICAL_IMPORT_DATA_TYPES, isCanonicalImportDataType } from "./canonical-types";

export { DEPRECATED_LABEL_INDEX, TERMINOLOGY, getLabelAr } from "./terminology";

export { canCanonicalExecute, isComingSoon } from "./availability";

export {
  buildImportRegistry,
  getImportDefinition,
  listImportDefinitions,
  listImportDefinitionsByPhase,
} from "./registry";
