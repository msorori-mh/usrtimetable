import { useCurrentUser } from "@/hooks/use-current-user";
import { isReportsOnlyRole } from "@/lib/viewer-roles";

/**
 * True when the signed-in account is `read_only`-ONLY: every timetable report it
 * opens must read a PUBLISHED schedule version. Admins and institutional viewers
 * return false and keep their current sources.
 */
export function usePublishedOnlyReports(): boolean {
  const { data: me } = useCurrentUser();
  return isReportsOnlyRole(me);
}
