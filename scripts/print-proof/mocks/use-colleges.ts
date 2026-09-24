/**
 * Full-shell print proof — fixed active college so the REAL AppLayout renders the
 * page context bar with its college badge (the chrome that leaked into print).
 */
export interface CollegeRef {
  id: string;
  name: string;
  code: string | null;
  university_id: string;
}

const FIXTURE_COLLEGE: CollegeRef = {
  id: "00000000-0000-0000-0000-0000000000c1",
  name: "كلية تكنولوجيا المعلومات وعلوم الحاسوب (فكسچر اختباري)",
  code: "FX-IT",
  university_id: "00000000-0000-0000-0000-0000000000u1",
};

export function useAccessibleColleges() {
  return { data: [FIXTURE_COLLEGE], isLoading: false } as const;
}

export function useActiveCollege() {
  return {
    colleges: [FIXTURE_COLLEGE],
    activeId: FIXTURE_COLLEGE.id,
    active: FIXTURE_COLLEGE,
    setActiveId: () => {},
    isLoading: false,
  };
}
