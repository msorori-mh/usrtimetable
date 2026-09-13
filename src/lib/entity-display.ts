/**
 * Presentation-only entity naming.
 *
 * Human-readable names always win. Codes stay available to search, forms,
 * values, imports, and relations, but are only used as a last-resort label
 * when an entity has no human name at all.
 */
export function entityDisplayName(entity: {
  name?: string | null;
  code?: string | null;
}, fallback = "—"): string {
  const name = entity.name?.trim();
  if (name) return name;
  const code = entity.code?.trim();
  return code || fallback;
}

export function instructorDisplayName(instructor: {
  full_name?: string | null;
  full_name_ar?: string | null;
  full_name_en?: string | null;
  employee_number?: string | null;
}, fallback = "مدرس غير محدد"): string {
  return (
    instructor.full_name?.trim() ||
    instructor.full_name_ar?.trim() ||
    instructor.full_name_en?.trim() ||
    instructor.employee_number?.trim() ||
    fallback
  );
}