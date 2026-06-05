export type ImportEntity = "instructors" | "rooms" | "academic_terms" | "daily_breaks";
export type ImportMode = "insert_only" | "update_existing" | "upsert";

export interface ColumnDef {
  key: string;          // internal field key
  header: string;       // Arabic header in Excel
  required?: boolean;
  example?: string;
  enumValues?: string[];
  type?: "text" | "number" | "time" | "boolean" | "days_csv";
}

export interface TemplateDef {
  entity: ImportEntity;
  label: string;        // Arabic label
  sheetName: string;
  columns: ColumnDef[];
  uniqueKey: string;    // field key used to detect duplicates / match existing rows
  uniqueKeyLabel: string;
}

export interface ParsedRow {
  rowNumber: number;            // 1-based excel row (data rows start at 2 — header is row 1)
  raw: Record<string, unknown>; // header -> raw value
  values: Record<string, unknown>; // key -> normalized value
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
