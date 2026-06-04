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
