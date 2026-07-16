/**
 * Delivery-group count rules for academic delivery V2.
 * Never invent capacity when required data is missing for strict splits.
 */
import type { GroupCountInput, GroupCountResult } from "./types";

function ceilDiv(n: number, d: number): number {
  return Math.ceil(n / d);
}

/**
 * Compute how many delivery_groups to materialize for a component.
 *
 * - theory: 1 by default; split only when students exceed room-type default_capacity
 * - practical: ceil(students / strict lab capacity); requires strict_capacity + capacity > 0
 * - tutorial: same capacity-based split as theory when capacity known; else 1 + warning
 * - project: explicit_group_count if > 0, else 1 (not in regular load)
 * - summer_training: 0 (no weekly groups)
 */
export function computeDeliveryGroupCount(input: GroupCountInput): GroupCountResult {
  const students = Math.max(0, Math.floor(input.student_count));
  const rt = input.roomType;

  switch (input.component_type) {
    case "summer_training":
      return { ok: true, group_count: 0, capacity_limit: null };

    case "project": {
      const explicit = input.explicit_group_count;
      if (explicit != null) {
        if (!Number.isInteger(explicit) || explicit < 1) {
          return {
            ok: false,
            group_count: 0,
            capacity_limit: null,
            error_code: "invalid_project_group_count",
            message_ar: "عدد مجموعات المشروع يجب أن يكون عددًا صحيحًا ≥ 1.",
          };
        }
        return { ok: true, group_count: explicit, capacity_limit: null };
      }
      return { ok: true, group_count: 1, capacity_limit: null };
    }

    case "practical": {
      if (!rt || !rt.strict_capacity) {
        return {
          ok: false,
          group_count: 0,
          capacity_limit: null,
          error_code: "missing_strict_lab_capacity",
          message_ar:
            "المكوّن العملي يتطلب نوع قاعة بسعة صارمة (strict_capacity) وسعة افتراضية موجبة. لا يتم التخمين.",
        };
      }
      if (!(rt.default_capacity > 0)) {
        return {
          ok: false,
          group_count: 0,
          capacity_limit: null,
          error_code: "invalid_lab_capacity",
          message_ar: "سعة المعمل الصارمة يجب أن تكون أكبر من صفر.",
        };
      }
      const cap = rt.default_capacity;
      const count = students <= 0 ? 1 : ceilDiv(students, cap);
      return { ok: true, group_count: count, capacity_limit: cap };
    }

    case "theory":
    case "tutorial": {
      if (!rt || !(rt.default_capacity > 0)) {
        return {
          ok: true,
          group_count: 1,
          capacity_limit: null,
          warning:
            input.component_type === "theory"
              ? "theory_capacity_missing_kept_single_group"
              : "tutorial_capacity_missing_kept_single_group",
        };
      }
      const cap = rt.default_capacity;
      if (students <= cap) {
        return { ok: true, group_count: 1, capacity_limit: cap };
      }
      return { ok: true, group_count: ceilDiv(students, cap), capacity_limit: cap };
    }

    default:
      return {
        ok: false,
        group_count: 0,
        capacity_limit: null,
        error_code: "unsupported_component",
        message_ar: `مكوّن غير معتمد للتقسيم: ${input.component_type}`,
      };
  }
}

/** Stable group codes: G1, G2, … */
export function buildGroupCodes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `G${i + 1}`);
}

/** Distribute students across groups as evenly as possible. */
export function distributeStudents(total: number, groupCount: number): number[] {
  if (groupCount <= 0) return [];
  const base = Math.floor(total / groupCount);
  const rem = total % groupCount;
  return Array.from({ length: groupCount }, (_, i) => base + (i < rem ? 1 : 0));
}
