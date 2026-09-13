import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getActiveCollegeId,
  resolveActiveCollege,
  setActiveCollegeId,
  subscribeActiveCollegeId,
} from "@/lib/active-college-store";

export {
  ACTIVE_COLLEGE_STORAGE_KEY,
  buildCollegeScopedSavePayload,
  collegeScopedQueryKey,
  getActiveCollegeId,
  resolveActiveCollege,
  setActiveCollegeId,
  shouldResetTermFilter,
  subscribeActiveCollegeId,
} from "@/lib/active-college-store";
import { isReportsOnlyRole, scopeCollegesForRole } from "@/lib/academic-affairs-role";

export interface CollegeRef {
  id: string;
  name: string;
  code: string | null;
  university_id: string;
}

export function useAccessibleColleges() {
  return useQuery({
    queryKey: ["accessible-colleges"],
    queryFn: async (): Promise<CollegeRef[]> => {
      const { data, error } = await supabase
        .from("colleges")
        .select("id, name, code, university_id")
        .order("name");
      if (error) throw error;
      const colleges = data ?? [];

      // Academic affairs («إدارة الشؤون الأكاديمية») is NOT an institution-wide
      // reader: its reports must stay inside the colleges assigned in
      // user_colleges, so the accessible list is narrowed here (read scope only).
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return colleges;
      const [rolesRes, assignedRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("user_colleges").select("college_id").eq("user_id", uid),
      ]);
      const roles = (rolesRes.data ?? []).map((r) => r.role as string);
      const reportsOnly = isReportsOnlyRole({
        isSuperAdmin: roles.includes("super_admin"),
        isCollegeAdmin: roles.includes("college_admin"),
        isInstitutionalViewer: roles.includes("institutional_viewer"),
      });
      return scopeCollegesForRole(
        colleges,
        (assignedRes.data ?? []).map((c) => c.college_id),
        reportsOnly,
      );
    },
    staleTime: 60_000,
  });
}

export function useActiveCollege() {
  const { data: colleges, isLoading } = useAccessibleColleges();
  const activeId = useSyncExternalStore(subscribeActiveCollegeId, getActiveCollegeId, () => null);

  useEffect(() => {
    if (!colleges || colleges.length === 0) return;
    if (!activeId || !colleges.some((c) => c.id === activeId)) {
      setActiveCollegeId(colleges[0].id);
    }
  }, [colleges, activeId]);

  return {
    colleges: colleges ?? [],
    activeId,
    active: resolveActiveCollege(colleges ?? [], activeId),
    setActiveId: setActiveCollegeId,
    isLoading,
  };
}
