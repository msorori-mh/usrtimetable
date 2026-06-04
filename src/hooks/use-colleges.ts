import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

const KEY = "active-college-id";

export function useActiveCollege() {
  const { data: colleges, isLoading } = useAccessibleColleges();
  const [activeId, setActiveId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(KEY),
  );

  useEffect(() => {
    if (!colleges || colleges.length === 0) return;
    if (!activeId || !colleges.some((c) => c.id === activeId)) {
      const next = colleges[0].id;
      setActiveId(next);
      localStorage.setItem(KEY, next);
    }
  }, [colleges, activeId]);

  const set = (id: string) => {
    setActiveId(id);
    localStorage.setItem(KEY, id);
  };

  return {
    colleges: colleges ?? [],
    activeId,
    active: colleges?.find((c) => c.id === activeId) ?? null,
    setActiveId: set,
    isLoading,
  };
}
