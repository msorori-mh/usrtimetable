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
import { isViewerOnlyRole, scopeCollegesForRole } from "@/lib/viewer-roles";

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

      // Viewer roles («مشاهد» / «مشاهد مؤسسي») are not institution-wide readers
      // by role: their reads stay inside the colleges assigned in user_colleges
      // (a database trigger keeps that list at all colleges). Read scope only.
      const { data: userData, error: identityError } = await supabase.auth.getUser();
      if (identityError) throw identityError;
      const uid = userData.user?.id;
      // Fail closed: without an identity we cannot prove a college is assigned.
      if (!uid) return [];
      const [rolesRes, assignedRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("user_colleges").select("college_id").eq("user_id", uid),
      ]);
      const roles = (rolesRes.data ?? []).map((r) => r.role as string);
      if (rolesRes.error || assignedRes.error) throw rolesRes.error ?? assignedRes.error;
      // Leadership reads all colleges through RLS, without granting admin membership.
      if (roles.includes("university_leadership")) return colleges;
      const viewerOnly = isViewerOnlyRole({
        isSuperAdmin: roles.includes("super_admin"),
        isCollegeAdmin: roles.includes("college_admin"),
        isReadOnly: roles.includes("read_only"),
        isInstitutionalViewer: roles.includes("institutional_viewer"),
        isCollegeDean: roles.includes("college_dean"),
      });
      return scopeCollegesForRole(
        colleges,
        (assignedRes.data ?? []).map((c) => c.college_id),
        viewerOnly,
      );
    },
    staleTime: 60_000,
  });
}

export function useActiveCollege() {
  const { data: colleges, isLoading, isFetching, error, refetch } = useAccessibleColleges();
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
    isFetching,
    error,
    refetch,
  };
}
