import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorState, RoutePendingState } from "@/components/route-states";

export const getRouter = () => {
  // Heavy college-scoped reads: one bounded retry instead of a retry storm on
  // timeout, and a short freshness window so revisiting a screen reuses data.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        staleTime: 30_000,
        // Re-focusing many open college tabs must not reload every heavy report.
        // Navigation and explicit refresh/mutation invalidation still revalidate.
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering/focusing a link warms its route; React Query decides freshness.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Errors and loading render inside the layout instead of replacing the app shell.
    defaultErrorComponent: RouteErrorState,
    defaultPendingComponent: RoutePendingState,
    defaultPendingMs: 300,
  });

  return router;
};
