/** Resolve version-only maxima without changing university instructor records. */
export function applyVersionInstructorLimits<T extends {
  id: string; max_attendance_days_per_week?: number | null;
}>(instructors: T[], overrides: unknown): T[] {
  if (overrides == null) return instructors;
  if (typeof overrides !== "object" || Array.isArray(overrides))
    throw new Error("تعذر التحقق من استثناءات أيام حضور المحاضرين.");
  const limits = overrides as Record<string, unknown>;
  for (const value of Object.values(limits))
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 6)
      throw new Error("حد أيام حضور المحاضر غير صالح.");
  return instructors.map((instructor) =>
    limits[instructor.id] == null ? instructor : {
      ...instructor,
      max_attendance_days_per_week: limits[instructor.id] as number,
    },
  );
}
