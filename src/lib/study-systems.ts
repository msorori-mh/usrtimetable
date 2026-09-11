/** The two study systems used by the university; values remain stable for storage/import. */
export const ACADEMIC_STUDY_SYSTEMS = ["regular", "parallel"] as const;

export const ACADEMIC_STUDY_SYSTEM_LABELS = {
  regular: "النظام العام",
  parallel: "الموازي (نفقة خاصة)",
} as const;
