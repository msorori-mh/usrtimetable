/**
 * Shared classification keeps printable room reports and leadership capacity
 * metrics on the same definition of a lecture hall.
 */
export function roomCategoryFromType(code: string | null | undefined): "hall" | "lab" {
  const normalized = (code ?? "").toLocaleLowerCase();
  return normalized.includes("lab") || normalized === "workshop" ? "lab" : "hall";
}
