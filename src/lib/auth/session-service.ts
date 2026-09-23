import { supabase } from "@/integrations/supabase/client";
import { checkAuthenticatedSession } from "./check-session";

export function checkCurrentSession(signal: AbortSignal) {
  return checkAuthenticatedSession(
    {
      getUser: () => supabase.auth.getUser(),
      accessStatus: (requestSignal) =>
        supabase.rpc("security_access_status").abortSignal(requestSignal),
    },
    signal,
  );
}
