import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * L-7: the signed-in user's presentation flags (public.user_feature_flags).
 * RLS returns only the caller's own rows. Flags never grant permissions; a
 * failed read simply means "no flags" (default presentation).
 */
export function useOwnFeatureFlags(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["own-feature-flags", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("user_feature_flags" as never)
        .select("flag")
        .eq("user_id", userId as string);
      if (error) return new Set();
      return new Set(((data ?? []) as Array<{ flag: string }>).map((r) => r.flag));
    },
  });
}
