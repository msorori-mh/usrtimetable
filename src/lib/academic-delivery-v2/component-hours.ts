/**
 * Parse and validate explicit plan-course component hours.
 * Never silently invent a hours distribution from credit_hours or lectures_per_week.
 */
import {
  COMPONENT_TYPES,
  type ComponentHoursInput,
  type ComponentType,
  type ParsedComponentHours,
} from "./types";

const HOUR_KEYS: Array<{ key: keyof ComponentHoursInput; type: ComponentType }> = [
  { key: "theory_hours", type: "theory" },
  { key: "practical_hours", type: "practical" },
  { key: "tutorial_hours", type: "tutorial" },
  { key: "project_hours", type: "project" },
  { key: "summer_training_hours", type: "summer_training" },
];

export interface ComponentHoursValidationError {
  code: string;
  column?: string;
  message_ar: string;
}

function isProvided(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

function parsePositiveHours(
  v: unknown,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (!isProvided(v)) return { ok: true, value: 0 };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return { ok: false, reason: "not_number" };
  if (n < 0) return { ok: false, reason: "negative" };
  if (n === 0) return { ok: true, value: 0 };
  // Allow integers or one-decimal contact hours (e.g. 1.5)
  const scaled = Math.round(n * 100) / 100;
  if (Math.abs(scaled - n) > 1e-9) return { ok: false, reason: "precision" };
  return { ok: true, value: scaled };
}

function componentDefaults(
  type: ComponentType,
): Omit<ParsedComponentHours["components"][number], "component_type" | "weekly_contact_hours"> {
  switch (type) {
    case "project":
      return {
        is_timetabled: true,
        counts_toward_regular_load: false,
        counts_toward_overtime: false,
        compensation_mode: "none",
      };
    case "summer_training":
      return {
        is_timetabled: false,
        counts_toward_regular_load: false,
        counts_toward_overtime: false,
        compensation_mode: "none",
      };
    default:
      return {
        is_timetabled: true,
        counts_toward_regular_load: true,
        counts_toward_overtime: true,
        compensation_mode: "per_hour",
      };
  }
}

/**
 * Returns components to upsert (hours > 0 only), or validation errors.
 * If no explicit component hour column is present at all → missing_component_hours.
 */
export function parsePlanComponentHours(
  input: ComponentHoursInput,
  opts?: { credit_hours?: number | null; requireExplicit?: boolean },
):
  | { ok: true; data: ParsedComponentHours }
  | { ok: false; errors: ComponentHoursValidationError[] } {
  const errors: ComponentHoursValidationError[] = [];
  const requireExplicit = opts?.requireExplicit !== false;

  const anyExplicit = HOUR_KEYS.some(({ key }) => isProvided(input[key]));
  if (!anyExplicit) {
    if (requireExplicit) {
      errors.push({
        code: "missing_component_hours",
        message_ar:
          "ساعات المكونات الصريحة مطلوبة (ساعات_نظري / ساعات_عملي / ساعات_تمارين / ساعات_مشروع / ساعات_تدريب_صيفي). لا يتم تخمين التوزيع من الساعات المعتمدة أو عدد المحاضرات.",
      });
      return { ok: false, errors };
    }
    return { ok: true, data: { components: [], warnings: [] } };
  }

  const components: ParsedComponentHours["components"] = [];
  let sum = 0;

  for (const { key, type } of HOUR_KEYS) {
    if (!COMPONENT_TYPES.includes(type)) {
      errors.push({
        code: "unsupported_component",
        column: key,
        message_ar: `مكوّن غير معتمد: ${type}`,
      });
      continue;
    }
    if (!isProvided(input[key])) continue;
    const parsed = parsePositiveHours(input[key]);
    if (!parsed.ok) {
      const msg =
        parsed.reason === "negative"
          ? "يجب أن تكون ساعات المكوّن عددًا موجبًا أو صفرًا"
          : parsed.reason === "precision"
            ? "ساعات المكوّن يجب أن تكون بعد منزلتين عشريتين كحد أقصى"
            : "ساعات المكوّن يجب أن تكون رقمًا صالحًا";
      errors.push({ code: "invalid_component_hours", column: key, message_ar: msg });
      continue;
    }
    if (parsed.value <= 0) continue; // zero/empty → do not create component
    sum += parsed.value;
    components.push({
      component_type: type,
      weekly_contact_hours: parsed.value,
      ...componentDefaults(type),
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  if (components.length === 0) {
    errors.push({
      code: "no_positive_component_hours",
      message_ar: "يجب توفير ساعة موجبة واحدة على الأقل لأحد المكونات المعتمدة.",
    });
    return { ok: false, errors };
  }

  const warnings: string[] = [];
  const credit = opts?.credit_hours;
  if (credit != null && Number.isFinite(credit) && credit > 0) {
    // Soft consistency: contact hours often differ from credit hours; only flag extreme mismatch.
    if (sum > credit * 4) {
      warnings.push(
        `مجموع ساعات المكونات (${sum}) أكبر بكثير من الساعات المعتمدة (${credit}) — راجع التوزيع.`,
      );
    }
  }

  return { ok: true, data: { components, warnings } };
}

export function isApprovedComponentType(v: string): v is ComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(v);
}
