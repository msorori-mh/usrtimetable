export type ImportEntity =
  | "instructors"
  | "rooms"
  | "academic_terms"
  | "daily_breaks"
  | "study_plan_courses"
  | "full_study_plan"
  | "course_offerings"
  | "teaching_assignments"
  | "course_programs"
  | "section_groups";

export type ImportMode = "insert_only" | "update_existing" | "upsert";

export interface ColumnDef {
  key: string;
  header: string;
  required?: boolean;
  example?: string;
  enumValues?: string[];
  type?: "text" | "number" | "time" | "boolean" | "days_csv" | "csv";
}

export interface TemplateDef {
  entity: ImportEntity;
  label: string;
  sheetName: string;
  columns: ColumnDef[];
  uniqueKey: string;        // for simple table imports OR a logical composite label
  uniqueKeyLabel: string;
  /** "table" = generic 1:1 mapping to a table; "custom" = entity-specific commit handler */
  commitMode?: "table" | "custom";
  /** target table for simple table mode (defaults to entity) */
  targetTable?: string;
}

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface RowError {
  rowNumber: number;
  columnName?: string;
  errorCode: string;
  message: string;
  rawValue?: string;
}

export interface ValidationResult {
  validRows: ParsedRow[];
  invalidRows: ParsedRow[];
  errors: RowError[];
}
