/**
 * Tab-local active-college store — shared across hook instances, isolated from other tabs.
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
let activeId: string | null | undefined;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Seed a tab once from its session, then the last choice used by a new tab.
 * Never let another tab's storage event replace the scope of a running operation. */
export function getActiveCollegeId(): string | null {
  if (!hasWindow()) return null;
  if (activeId !== undefined) return activeId;
  activeId = null;
  try {
    activeId = window.sessionStorage.getItem(ACTIVE_COLLEGE_STORAGE_KEY);
  } catch {
    /* Memory still isolates the tab when storage is unavailable. */
  }
  if (activeId === null) {
    try {
      activeId = window.localStorage.getItem(ACTIVE_COLLEGE_STORAGE_KEY);
    } catch {
      /* A first-time tab can select its college through the normal UI. */
    }
  }
  if (activeId !== null) {
    try {
      window.sessionStorage.setItem(ACTIVE_COLLEGE_STORAGE_KEY, activeId);
    } catch {
      /* Keep the initialized in-memory scope. */
    }
  }
  return activeId;
}

/**
 * Persist and broadcast the active college id to every subscriber in this tab
 * (localStorage "storage" events alone do not fire in the same tab).
 */
export function setActiveCollegeId(id: string): void {
  if (!hasWindow()) return;
  activeId = id;
  try {
    window.sessionStorage.setItem(ACTIVE_COLLEGE_STORAGE_KEY, id);
  } catch {
    /* Same-tab subscribers must still receive the new scope. */
  }
  try {
    window.localStorage.setItem(ACTIVE_COLLEGE_STORAGE_KEY, id);
  } catch {
    /* Remembering a default for new tabs is optional. */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeActiveCollegeId(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
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
