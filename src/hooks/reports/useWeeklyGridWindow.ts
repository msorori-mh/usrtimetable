import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { weeklyGridWindow, type WeeklyGridWindow } from "@/lib/reports/weekly-grid-window";

/**
 * Reads the college's operating window (working days + day start/end) so every
 * weekly report grid renders the configured hours instead of a fixed range.
 * Read-only; scheduling data is never written here.
 */
export function useWeeklyGridWindow(collegeId?: string | null): {
  window: WeeklyGridWindow;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ["weekly-grid-window", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduling_settings")
        .select("working_days, day_start_time, day_end_time")
        .eq("college_id", collegeId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
  return { window: weeklyGridWindow(query.data), isLoading: query.isLoading };
}
