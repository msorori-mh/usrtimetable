/** Deduplicate session reconfirmation events; never authorize from these events. */
export function createAuthRefreshCoordinator(actions: { clear: () => void; refresh: () => void }) {
  let userId: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  return {
    handle(event: string, nextUserId: string | null) {
      if (disposed) return;
      if (event === "INITIAL_SESSION") {
        userId = nextUserId;
        return;
      }
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (event === "SIGNED_IN" && userId === nextUserId) return;
      if (event === "SIGNED_OUT" || userId !== nextUserId) actions.clear();
      userId = event === "SIGNED_OUT" ? null : nextUserId;
      clearTimeout(timer);
      // Release the auth callback before query functions can call Supabase.
      timer = setTimeout(() => {
        if (!disposed) actions.refresh();
      }, 0);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
