export interface SchedulingPolicyInput {
  working_days?: unknown;
  day_start_time?: unknown;
  day_end_time?: unknown;
  slot_minutes?: unknown;
  min_session_hours?: unknown;
  max_session_hours?: unknown;
  max_daily_hours_per_instructor?: unknown;
  max_daily_hours_per_section?: unknown;
  max_daily_theory_hours_per_section?: unknown;
  max_daily_practical_hours_per_section?: unknown;
  max_extended_days_per_partition?: unknown;
  break_between_sessions_min?: unknown;
}

export interface SchedulingPolicyIssue {
  code: string;
  messageAr: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const timeMinutes = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
};

export function validateSchedulingPolicy(
  policy: SchedulingPolicyInput,
): SchedulingPolicyIssue[] {
  const issues: SchedulingPolicyIssue[] = [];
  const days = Array.isArray(policy.working_days) ? policy.working_days : [];
  const validDays = days.every(
    (day) =>
      Number.isInteger(Number(day)) && Number(day) >= 0 && Number(day) <= 6,
  );
  if (
    !days.length ||
    !validDays ||
    new Set(days.map(Number)).size !== days.length
  ) {
    issues.push({
      code: "WORKING_DAYS_INVALID",
      messageAr: "يجب اختيار يوم عمل واحد على الأقل دون تكرار.",
    });
  }

  const start = timeMinutes(policy.day_start_time);
  const end = timeMinutes(policy.day_end_time);
  if (start === null || end === null || end <= start) {
    issues.push({
      code: "DAY_WINDOW_INVALID",
      messageAr: "وقت نهاية اليوم يجب أن يكون بعد وقت البداية.",
    });
  }

  if (!finite(policy.slot_minutes) || policy.slot_minutes <= 0) {
    issues.push({
      code: "SLOT_MINUTES_INVALID",
      messageAr: "حجم الفترة يجب أن يكون عددًا موجبًا.",
    });
  }

  if (
    !finite(policy.min_session_hours) ||
    !finite(policy.max_session_hours) ||
    policy.min_session_hours <= 0 ||
    policy.max_session_hours < policy.min_session_hours
  ) {
    issues.push({
      code: "SESSION_DURATION_INVALID",
      messageAr: "مدة المحاضرة القصوى يجب ألا تقل عن المدة الدنيا الموجبة.",
    });
  }

  for (const [key, value, label] of [
    [
      "INSTRUCTOR_DAILY_LIMIT_INVALID",
      policy.max_daily_hours_per_instructor,
      "سقف ساعات المحاضر",
    ],
    [
      "STUDENT_DAILY_LIMIT_INVALID",
      policy.max_daily_hours_per_section,
      "سقف ساعات المجموعة",
    ],
    [
      "THEORY_DAILY_LIMIT_INVALID",
      policy.max_daily_theory_hours_per_section,
      "سقف الساعات النظرية",
    ],
    [
      "PRACTICAL_DAILY_LIMIT_INVALID",
      policy.max_daily_practical_hours_per_section,
      "سقف الساعات العملية",
    ],
  ] as const) {
    if (
      value !== undefined &&
      value !== null &&
      (!finite(value) || value <= 0)
    ) {
      issues.push({
        code: key,
        messageAr: `${label} يجب أن يكون عددًا موجبًا.`,
      });
    }
  }

  if (
    policy.max_extended_days_per_partition !== undefined &&
    (!finite(policy.max_extended_days_per_partition) ||
      policy.max_extended_days_per_partition < 0)
  ) {
    issues.push({
      code: "EXTENDED_DAYS_INVALID",
      messageAr: "عدد أيام التمديد لا يمكن أن يكون سالبًا.",
    });
  }
  if (
    policy.break_between_sessions_min !== undefined &&
    (!finite(policy.break_between_sessions_min) ||
      policy.break_between_sessions_min < 0)
  ) {
    issues.push({
      code: "BREAK_INVALID",
      messageAr: "الفاصل بين المحاضرات لا يمكن أن يكون سالبًا.",
    });
  }
  return issues;
}

export function assertValidSchedulingPolicy(
  policy: SchedulingPolicyInput,
): void {
  const issues = validateSchedulingPolicy(policy);
  if (!issues.length) return;
  throw new Error(
    `SCHEDULING_POLICY_INVALID: ${issues.map((issue) => issue.messageAr).join("؛ ")}`,
  );
}
