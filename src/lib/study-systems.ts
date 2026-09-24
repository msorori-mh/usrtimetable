/** The two study systems used by the university; values remain stable for storage/import. */
export const ACADEMIC_STUDY_SYSTEMS = ["regular", "parallel"] as const;

export const ACADEMIC_STUDY_SYSTEM_LABELS = {
  regular: "النظام العام",
  parallel: "الموازي (نفقة خاصة)",
} as const;

/** College policy confirmed by university administration; unknown colleges retain existing options. */
export function collegeSupportsParallel(college?: { name?: string | null } | null): boolean {
  const name = (college?.name ?? "")
    .normalize("NFKC")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
  return ![
    "كلية الاداب والعلوم الانسانية",
    "كلية التربية والعلوم",
    "كلية الشريعة والقانون",
    "كلية التربية والعلوم الانسانية والتطبيقية - الجوف",
  ].includes(name);
}
