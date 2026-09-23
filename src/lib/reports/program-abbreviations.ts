const PROGRAM_ABBREVIATIONS: Readonly<Record<string, string>> = {
  "تكنولوجيا المعلومات": "IT",
  "تقنية المعلومات": "IT",
  "information technology": "IT",
  it: "IT",
  "الامن السيبراني": "Cyb",
  "cyber security": "Cyb",
  cybersecurity: "Cyb",
  cyb: "Cyb",
  "علوم الحاسوب": "CS",
  "computer science": "CS",
  cs: "CS",
  "الذكاء الاصطناعي": "AI",
  "artificial intelligence": "AI",
  ai: "AI",
  "نظم المعلومات الحاسوبية": "ICS",
  "computer information systems": "ICS",
  cis: "ICS",
  ics: "ICS",
};

/** Display aliases only; the program's own name identifies its branch. */
export function compactProgramLabel(programName: string): string {
  const original = programName.trim();
  const normalized = original
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const jawfSuffix = /(?:\s*[-–—]\s*|\s+)(?:فرع\s+)?(?:الجوف|al[- ]?jawf|jawf|jwf)$/i;
  const isJawf = jawfSuffix.test(normalized);
  const base = normalized.replace(jawfSuffix, "").trim();
  const abbreviation = PROGRAM_ABBREVIATIONS[base];
  // Preserve unrecognized programs instead of inventing an ambiguous abbreviation.
  return abbreviation ? `${abbreviation}${isJawf ? "-Jwf" : ""}` : original;
}
