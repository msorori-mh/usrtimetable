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
      return data ?? [];
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
