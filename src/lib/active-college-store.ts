/**
 * Shared active-college id store — single source of truth across hook instances.
 * Pure module (no React / Supabase) so harnesses can import it safely.
 */

export const ACTIVE_COLLEGE_STORAGE_KEY = "active-college-id";

export interface CollegeRefLike {
  id: string;
  name: string;
  code?: string | null;
  university_id?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Read the shared active college id (single source of truth). */
export function getActiveCollegeId(): string | null {
  if (!hasWindow()) return null;
  return localStorage.getItem(ACTIVE_COLLEGE_STORAGE_KEY);
}

/**
 * Persist and broadcast the active college id to every subscriber in this tab
 * (localStorage "storage" events alone do not fire in the same tab).
 */
export function setActiveCollegeId(id: string): void {
  if (!hasWindow()) return;
  localStorage.setItem(ACTIVE_COLLEGE_STORAGE_KEY, id);
  listeners.forEach((listener) => listener());
}

export function subscribeActiveCollegeId(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACTIVE_COLLEGE_STORAGE_KEY) listener();
  };
  const canUseStorageEvents = hasWindow() && typeof window.addEventListener === "function";
  if (canUseStorageEvents) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (canUseStorageEvents) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** Resolve the college object for the current shared id (no silent fallback). */
export function resolveActiveCollege<T extends CollegeRefLike>(
  colleges: T[],
  activeId: string | null,
): T | null {
  if (!activeId) return null;
  return colleges.find((c) => c.id === activeId) ?? null;
}

/** True when a selected term id is not in the current college's term list. */
export function shouldResetTermFilter(
  termFilter: string,
  terms: Array<{ id: string }> | undefined | null,
): boolean {
  if (termFilter === "all") return false;
  if (!terms) return false;
  return !terms.some((t) => t.id === termFilter);
}

/** Build a React Query key that always includes the current college id. */
export function collegeScopedQueryKey(
  prefix: string,
  collegeId: string | null | undefined,
  ...rest: unknown[]
): unknown[] {
  return [prefix, collegeId, ...rest];
}

/** Save payload college_id must be the id at save time (no stale closure substitute). */
export function buildCollegeScopedSavePayload<T extends Record<string, unknown>>(
  collegeId: string,
  row: T,
): T & { college_id: string } {
  return { ...row, college_id: collegeId };
}
