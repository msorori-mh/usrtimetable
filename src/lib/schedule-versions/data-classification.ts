/**
 * First-class schedule-version data classification helpers.
 * Works with optional `data_classification` (post-migration) and falls back to
 * DELIVERY_DEMO name/notes markers today (pre-migration).
 */
import { DELIVERY_DEMO_MARKER, isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";
import { PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID } from "@/lib/schedule-versions/disposable-purge";

export {
  DELIVERY_DEMO_MARKER,
  DELIVERY_DEMO_WARNING_AR,
  isDeliveryDemoVersion,
} from "@/lib/schedule-versions/delivery-demo";

export { PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID };

/** Allowed DB values once `data_classification` column is applied. */
export const DATA_CLASSIFICATIONS = ["test", "demo", "operational", "archived"] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export type ClassificationSource = {
  id?: string | null;
  data_classification?: string | null;
  name?: string | null;
  notes?: string | null;
};

export const CLASSIFICATION_LABEL_AR: Record<DataClassification, string> = {
  test: "اختبار",
  demo: "تجريبي / عرض",
  operational: "تشغيلي",
  archived: "مؤرشف",
};

export const CLASSIFICATION_LABEL_EN: Record<DataClassification, string> = {
  test: "TEST",
  demo: "DEMO",
  operational: "OPERATIONAL",
  archived: "ARCHIVED",
};

/** Official UI listing filter modes. */
export type ClassificationListFilter =
  | "official"
  | "all"
  | "demo"
  | "test"
  | "operational"
  | "archived"
  | "demo_and_test";

export function isDataClassification(value: unknown): value is DataClassification {
  return (
    typeof value === "string" &&
    (DATA_CLASSIFICATIONS as readonly string[]).includes(value.toLowerCase())
  );
}

/**
 * Resolve classification from column when present; otherwise infer demo from markers.
 * Returns null when unclassified and not marker-demo (no Operational assumption).
 */
export function resolveDataClassification(input: ClassificationSource): DataClassification | null {
  const raw = input.data_classification?.trim().toLowerCase() ?? "";
  if (isDataClassification(raw)) return raw;
  if (isDeliveryDemoVersion({ name: input.name, notes: input.notes })) return "demo";
  return null;
}

/** Demo or test — never treated as official operational reporting data. */
export function isDemoOrTestClassification(input: ClassificationSource): boolean {
  const cls = resolveDataClassification(input);
  return cls === "demo" || cls === "test";
}

/**
 * Official report / published-schedule eligibility.
 * Fail-closed for demo/test (column or markers). Unclassified non-demo remains visible
 * so pre-migration UI keeps working. Explicit operational is eligible; archived is not.
 */
export function isOperationalOfficialReportEligible(input: ClassificationSource): boolean {
  const cls = resolveDataClassification(input);
  if (cls === "demo" || cls === "test" || cls === "archived") return false;
  if (cls === "operational") return true;
  // null / unclassified: eligible only when not demo-marked (already checked above)
  return true;
}

/**
 * Filter versions for official vs explicit classification views.
 * Default `official` hides demo/test; pass `all` or `demo` to keep demos visible.
 */
export function filterVersionsByClassification<T extends ClassificationSource>(
  versions: T[],
  filter: ClassificationListFilter = "official",
): T[] {
  if (filter === "all") return versions;
  if (filter === "official") {
    return versions.filter((v) => isOperationalOfficialReportEligible(v));
  }
  if (filter === "demo_and_test") {
    return versions.filter((v) => isDemoOrTestClassification(v));
  }
  return versions.filter((v) => resolveDataClassification(v) === filter);
}

/** UI-only: demo/test must not present “operational approval” messaging. */
export function shouldBlockOperationalApprovalMessaging(input: ClassificationSource): boolean {
  return isDemoOrTestClassification(input);
}

/** Stub: converting demo → operational requires a future official path (not implemented). */
export function canConvertToOperationalViaOfficialPath(_input: {
  isSuperAdmin: boolean;
  hasOfficialApprovalToken: boolean;
}): boolean {
  // Official convert path is intentionally not implemented in this mission.
  return false;
}

export function isProtectedAcceptedScheduleVersion(versionId: string | null | undefined): boolean {
  return versionId === PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID;
}
