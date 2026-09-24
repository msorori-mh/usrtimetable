/**
 * Full-shell print proof — fixed current user so the REAL AppLayout renders its
 * complete navigation, brand mark, role badge and mobile header without auth.
 */
export type AppRole = "super_admin" | "college_admin" | "read_only" | "institutional_viewer";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  isSuperAdmin: boolean;
  isCollegeAdmin: boolean;
  isReadOnly: boolean;
  isInstitutionalViewer: boolean;
}

const FIXTURE_USER: CurrentUser = {
  id: "00000000-0000-0000-0000-0000000000f1",
  email: "print-proof@test-only.invalid",
  fullName: "مستخدم فكسچر الطباعة",
  roles: ["college_admin"],
  isSuperAdmin: false,
  isCollegeAdmin: true,
  isReadOnly: false,
  isInstitutionalViewer: false,
};

export function useCurrentUser() {
  return { data: FIXTURE_USER, isLoading: false, isError: false, error: null } as const;
}
