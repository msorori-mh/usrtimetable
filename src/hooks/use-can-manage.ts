import { useMemo } from "react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCurrentUser } from "@/hooks/use-current-user";

export function useCanManageActiveCollege() {
  const { active } = useActiveCollege();
  const { data: me } = useCurrentUser();
  return useMemo(() => {
    if (!me || !active) return false;
    if (me.isSuperAdmin) return true;
    return me.isCollegeAdmin && me.collegeIds.includes(active.id);
  }, [me, active]);
}

/** Admins plus the dedicated academic-affairs role may edit existing instructor basic data. */
export function useCanEditInstructorsActiveCollege() {
  const { active } = useActiveCollege();
  const { data: me } = useCurrentUser();
  return useMemo(() => {
    if (!me || !active) return false;
    if (me.isSuperAdmin) return true;
    if (me.isCollegeAdmin && me.collegeIds.includes(active.id)) return true;
    return me.isInstitutionalViewer && me.collegeIds.includes(active.id);
  }, [me, active]);
}
