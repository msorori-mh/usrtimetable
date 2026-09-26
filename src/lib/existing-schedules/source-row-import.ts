import { sourceDuration } from "../reports/imported-timetable.ts";

export type SourceImportInput = {
  source_id: string;
  source_file: string;
  source_cell: string;
  program: string;
  level_number: number;
  raw_course: string;
  raw_teacher: string | null;
  raw_day: string | null;
  raw_time: string | null;
  raw_room: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  notes: string;
};

const cell = (value: unknown) => String(value ?? "").trim();
const emptyToNull = (value: unknown) => cell(value) || null;
const time = (value: unknown) => {
  const trimmed = cell(value);
  return trimmed ? (trimmed.length === 5 ? `${trimmed}:00` : trimmed) : null;
};

/** Validate a canonical source-row sheet before any production write. */
export function previewSourceRows(
  matrix: readonly Record<string, unknown>[],
  existing: readonly {
    source_id: string;
    source_file: string;
    source_cell: string;
    raw_course: string | null;
    level_number: number | null;
    raw_teacher: string | null;
    raw_day: string | null;
    raw_time: string | null;
    raw_room: string | null;
    day_of_week: number | null;
    start_time: string | null;
    end_time: string | null;
  }[],
) {
  const existingIds = new Map(existing.map((row) => [row.source_id, row]));
  const locationKeys = new Set(existing.map((row) => `${row.source_file}|_${row.source_cell}`));
  const seen = new Set<string>();
  const rows: SourceImportInput[] = [];
  const errors: string[] = [];
  let skipped = 0;
  matrix.forEach((raw, index) => {
    const label = `صف ${index + 2}`;
    const source_id = cell(raw.source_id);
    const source_file = cell(raw.source_file);
    const source_cell = cell(raw.source_cell);
    const program = cell(raw.program);
    const raw_course = cell(raw.raw_course);
    const level_number = Number(cell(raw.level_number));
    const dayRaw = cell(raw.day_of_week);
    const day_of_week = dayRaw === "" ? null : Number(dayRaw);
    const start_time = time(raw.start_time);
    const end_time = time(raw.end_time);
    if (
      !source_id ||
      !source_file ||
      !source_cell ||
      !program ||
      !raw_course ||
      !Number.isInteger(level_number) ||
      level_number < 1 ||
      level_number > 4 ||
      (day_of_week !== null &&
        (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6)) ||
      ((start_time || end_time) && sourceDuration(start_time, end_time) === null)
    ) {
      errors.push(`${label}: بيانات المصدر أو المستوى أو اليوم أو الوقت غير صحيحة`);
      return;
    }
    if (seen.has(source_id)) {
      errors.push(`${label}: معرف صف المصدر مكرر داخل الملف: ${source_id}`);
      return;
    }
    seen.add(source_id);
    const prior = existingIds.get(source_id);
    if (prior) {
      if (
        prior.source_file === source_file &&
        prior.source_cell === source_cell &&
        prior.raw_course === raw_course &&
        prior.level_number === level_number &&
        prior.raw_teacher === emptyToNull(raw.raw_teacher) &&
        prior.raw_day === emptyToNull(raw.raw_day) &&
        prior.raw_time === emptyToNull(raw.raw_time) &&
        prior.raw_room === emptyToNull(raw.raw_room) &&
        prior.day_of_week === day_of_week &&
        prior.start_time?.slice(0, 5) === start_time?.slice(0, 5) &&
        prior.end_time?.slice(0, 5) === end_time?.slice(0, 5)
      ) {
        skipped++;
        return;
      }
      errors.push(`${label}: معرف موجود ببيانات مختلفة: ${source_id}`);
      return;
    }
    if (locationKeys.has(`${source_file}|_${source_cell}`)) {
      errors.push(`${label}: موضع المصدر مستورد سابقًا بمعرف مختلف`);
      return;
    }
    locationKeys.add(`${source_file}|_${source_cell}`);
    rows.push({
      source_id,
      source_file,
      source_cell,
      program,
      level_number,
      raw_course,
      raw_teacher: emptyToNull(raw.raw_teacher),
      raw_day: emptyToNull(raw.raw_day),
      raw_time: emptyToNull(raw.raw_time),
      raw_room: emptyToNull(raw.raw_room),
      day_of_week,
      start_time,
      end_time,
      notes: JSON.stringify({
        raw_extraction: { id: source_id, dept: program },
        import_note: cell(raw.notes),
      }),
    });
  });
  return { rows, skipped, errors };
}
