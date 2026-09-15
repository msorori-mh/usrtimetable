// بحث عربي متسامح باسم المحاضر داخل صفوف مجموعات التدريس (عرض فقط — لا يغيّر البيانات).

const DIACRITICS = /[ً-ْٰـۖ-ۭ]/g; // eslint-disable-line no-misleading-character-class

export function normalizeArabicName(value: unknown): string {
  return String(value ?? "")
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ئؤ]/g, (c) => (c === "ئ" ? "ي" : "و"))
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function instructorNameMatches(name: string | null | undefined, query: string): boolean {
  const q = normalizeArabicName(query);
  if (!q) return true;
  return normalizeArabicName(name).includes(q);
}

export function filterRowsByInstructorName<
  T extends { instructors: ReadonlyArray<{ instructor_name: string | null }> },
>(rows: readonly T[], query: string): T[] {
  const q = normalizeArabicName(query);
  if (!q) return [...rows];
  return rows.filter((row) =>
    row.instructors.some((i) => instructorNameMatches(i.instructor_name, q)),
  );
}

export type InstructorAssignedHoursSummary = {
  totalHours: number;
  matchedInstructors: string[];
};

type InstructorHoursRow = {
  component_hours: number | null;
  instructors: ReadonlyArray<{
    instructor_name: string | null;
    assigned_component_hours: number | null;
    is_active?: boolean;
  }>;
};

/**
 * إجمالي الساعات الفعلية للمحاضر المطابق للبحث داخل الصفوف الحالية.
 * التدريس المشترك يعتمد الساعات الصريحة، والمدرس الوحيد يرجع لساعات المكوّن عند غيابها.
 */
export function summarizeInstructorAssignedHours(
  rows: readonly InstructorHoursRow[],
  query: string,
): InstructorAssignedHoursSummary {
  const q = normalizeArabicName(query);
  if (!q) return { totalHours: 0, matchedInstructors: [] };

  const names = new Map<string, string>();
  let totalHours = 0;

  for (const row of rows) {
    const activeInstructors = row.instructors.filter(
      (instructor) => instructor.is_active !== false,
    );
    for (const instructor of activeInstructors) {
      if (!instructorNameMatches(instructor.instructor_name, q)) continue;

      const displayName = String(instructor.instructor_name ?? "").trim();
      const normalizedName = normalizeArabicName(displayName);
      if (normalizedName && !names.has(normalizedName)) {
        names.set(normalizedName, displayName);
      }

      if (
        instructor.assigned_component_hours != null &&
        Number.isFinite(Number(instructor.assigned_component_hours))
      ) {
        totalHours += Number(instructor.assigned_component_hours);
      } else if (
        activeInstructors.length === 1 &&
        row.component_hours != null &&
        Number.isFinite(Number(row.component_hours))
      ) {
        totalHours += Number(row.component_hours);
      }
    }
  }

  return { totalHours, matchedInstructors: [...names.values()] };
}
