/** Exactly 15 — stable slugs; never rename (use deprecationMetadata.aliases) */
export type CanonicalImportDataType =
  | "academic_terms"
  | "departments"
  | "academic_programs"
  | "study_plan_rows"
  | "course_programs"
  | "instructors"
  | "rooms"
  | "instructor_availability"
  | "room_availability"
  | "time_slot_templates"
  | "daily_breaks"
  | "course_offerings"
  | "sections"
  | "teaching_assignments"
  | "section_groups";

export type ImportReleasePhase = "R1" | "R2" | "R3" | "R4" | "R5";

export type ImportAvailability = "available" | "coming_soon" | "deprecated" | "internal";

export type ImportCategory = "foundational" | "academic_plan" | "resources" | "scheduling";

export type ImportModePolicy = "CREATE_ONLY" | "UPDATE_ONLY" | "UPSERT" | "REPLACE_SCOPED";

export type CollegePermission = "can_view_college" | "can_manage_college";

export type ImportRole = "super_admin" | "college_admin";

export type NaturalKeyPart =
  | { kind: "field"; field: string }
  | { kind: "composite"; parts: string[] }
  | { kind: "logical"; description: string };

export interface NaturalKeyDefinition {
  parts: NaturalKeyPart[];
  summary: string;
}

/** Legacy = existing excel-import path. Canonical = new unified pipeline. */
export interface ImportCapabilityFlags {
  /** Existing parser in src/lib/excel-import still handles uploads */
  readonly legacyImportOperational: boolean;
  /** Official registry template generation — PR3+ */
  readonly canonicalTemplate: boolean;
  /** Unified preflight pipeline — PR6+ */
  readonly canonicalPreflight: boolean;
  /** Preview parity module — PR6+ */
  readonly canonicalPreview: boolean;
  /** Server transactional execution — PR7+ */
  readonly canonicalExecution: boolean;
  /** Runtime header alias adapter — PR4+ */
  readonly legacyHeaderAliases: boolean;
}

/** PR1 defaults — set legacyImportOperational per R1 type in definitions */
export const PR1_CAPABILITY_DEFAULTS: ImportCapabilityFlags = {
  legacyImportOperational: false,
  canonicalTemplate: false,
  canonicalPreflight: false,
  canonicalPreview: false,
  canonicalExecution: false,
  legacyHeaderAliases: false,
};

export interface ImportLabels {
  readonly ar: string;
  readonly en: string;
}

export interface ImportPermissions {
  readonly view: CollegePermission;
  readonly execute: CollegePermission;
  readonly roles: readonly ImportRole[];
}

export interface ImportTemplateIdentity {
  readonly templateId: string;
  readonly templateVersion: string;
}

export interface ImportDependency {
  readonly dataType: CanonicalImportDataType;
  readonly required: boolean;
}

export interface ImportDeprecationMetadata {
  readonly deprecatedAliases: readonly string[];
  readonly legacyEntityKeys?: readonly string[];
  readonly sunsetVersion?: string;
  readonly migrationNoteAr: string;
}

/** Full definition — columns deferred to PR3 */
export interface ImportDefinition {
  readonly dataType: CanonicalImportDataType;
  readonly templateIdentity: ImportTemplateIdentity;
  readonly labels: ImportLabels;
  readonly description: { readonly ar: string; readonly en: string };
  readonly category: ImportCategory;
  readonly targetEntity: string | readonly string[];
  readonly naturalKey: NaturalKeyDefinition;
  readonly dependencies: readonly ImportDependency[];
  readonly permissions: ImportPermissions;
  readonly importModePolicy: ImportModePolicy;
  readonly releasePhase: ImportReleasePhase;
  readonly availability: ImportAvailability;
  readonly capabilities: ImportCapabilityFlags;
  readonly deprecationMetadata?: ImportDeprecationMetadata;
  readonly maxRows: number;
  readonly sheetName: string;
}

export interface ImportDefinitionSummary {
  readonly dataType: CanonicalImportDataType;
  readonly templateId: string;
  readonly labels: ImportLabels;
  readonly category: ImportCategory;
  readonly releasePhase: ImportReleasePhase;
  readonly availability: ImportAvailability;
  readonly importModePolicy: ImportModePolicy;
  readonly dependencyCount: number;
  readonly legacyImportOperational: boolean;
}
