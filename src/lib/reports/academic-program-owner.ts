/** Academic ownership follows explicit canonical links, never program-name guesses.
 * Historical sessions stay in their original schedule/college storage scope. */
export interface AcademicProgramOwner {
  id: string;
  college_id: string;
  department_id: string | null;
  name: string;
  canonical_program_id: string | null;
}
export function resolveAcademicProgramOwner(
  id: string,
  programs: ReadonlyMap<string, AcademicProgramOwner>,
): AcademicProgramOwner {
  const visited = new Set<string>();
  let next = id;
  while (true) {
    if (visited.has(next))
      throw new Error("يوجد ربط دائري في البرنامج الأكاديمي المعتمد؛ راجع تبعية البرنامج.");
    visited.add(next);
    const program = programs.get(next);
    if (!program)
      throw new Error("تعذر قراءة البرنامج الأكاديمي المعتمد؛ لا يمكن تحديد كلية المحاضرة بدقة.");
    if (!program.canonical_program_id) return program;
    next = program.canonical_program_id;
  }
}
