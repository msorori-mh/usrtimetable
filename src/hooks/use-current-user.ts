import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "college_admin" | "read_only" | "institutional_viewer";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  collegeIds: string[];
  isSuperAdmin: boolean;
  isCollegeAdmin: boolean;
  isReadOnly: boolean;
  /** Institution-wide viewer: sees every page and college, may never write. */
  isInstitutionalViewer: boolean;
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const uid = userData.user.id;

  const [profileRes, rolesRes, collegesRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("id", uid).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", uid),
    supabase.from("user_colleges").select("college_id").eq("user_id", uid),
  ]);

  const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
  return {
    id: uid,
    email: profileRes.data?.email ?? userData.user.email ?? null,
    fullName: profileRes.data?.full_name ?? null,
    roles,
    collegeIds: (collegesRes.data ?? []).map((c) => c.college_id),
    isSuperAdmin: roles.includes("super_admin"),
    isCollegeAdmin: roles.includes("college_admin"),
    isReadOnly: roles.includes("read_only"),
  };
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: fetchCurrentUser,
    staleTime: 60_000,
  });
}
