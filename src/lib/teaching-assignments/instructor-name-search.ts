// بحث عربي متسامح باسم المحاضر داخل صفوف مجموعات التدريس (عرض فقط — لا يغيّر البيانات).

const DIACRITICS = /[ً-ْٰـۖ-ۭ]/g;

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
