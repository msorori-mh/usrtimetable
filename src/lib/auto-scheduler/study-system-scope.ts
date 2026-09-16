export type AutoScheduleScope = "all" | "regular" | "parallel";

export const AUTO_SCOPE_LABELS: Record<AutoScheduleScope, string> = {
  all: "جميع الأنظمة",
  regular: "النظام العام فقط",
  parallel: "النظام الموازي فقط",
};

/** Scope is an operational choice, never an authorization boundary. RPC guards remain authoritative. */
export function selectAutoScheduleScope<
  T extends {
    study_system: string | null;
    assignment_active: boolean;
    delivery_group_active: boolean;
    delivery_group_obsolete: boolean;
  },
>(rows: readonly T[], scope: AutoScheduleScope): T[] {
  if (!["all", "regular", "parallel"].includes(scope)) {
    throw new Error("INVALID_STUDY_SYSTEM_SCOPE");
  }
  if (scope === "all") return [...rows];
  // A cross-system shared lecture cannot be silently included or split.
  if (
    rows.some(
      (row) =>
        row.assignment_active &&
        row.delivery_group_active &&
        !row.delivery_group_obsolete &&
        row.study_system === "both",
    )
  ) {
    throw new Error("توجد محاضرة مشتركة بين النظامين؛ راجعها قبل توليد نظام واحد.");
  }
  return rows.filter((row) => row.study_system === scope);
}

/** Database completion certifies the entire version, not a selected system. */
export function autoScheduleRunStatus(scope: AutoScheduleScope, complete: boolean) {
  return scope === "all" && complete ? "completed" : "partial";
}
