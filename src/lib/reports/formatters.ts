export const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  return t.slice(0, 5);
}

export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}


export function compactAcademicLevelLabel(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  const withoutPrefix = raw.replace(/^(?:المستوى|مستوى)\s*/u, "").trim();
  const normalized = withoutPrefix
    .replace(/١/g, "1")
    .replace(/٢/g, "2")
    .replace(/٣/g, "3")
    .replace(/٤/g, "4")
    .replace(/٥/g, "5")
    .replace(/٦/g, "6")
    .replace(/٧/g, "7")
    .replace(/٨/g, "8");

  const labels: Record<string, string> = {
    "1": "الأول",
    "اول": "الأول",
    "الأول": "الأول",
    "2": "الثاني",
    "الثاني": "الثاني",
    "3": "الثالث",
    "الثالث": "الثالث",
    "4": "الرابع",
    "الرابع": "الرابع",
    "5": "الخامس",
    "الخامس": "الخامس",
    "6": "السادس",
    "السادس": "السادس",
    "7": "السابع",
    "السابع": "السابع",
    "8": "الثامن",
    "الثامن": "الثامن",
  };

  return labels[normalized] ?? withoutPrefix;
}
