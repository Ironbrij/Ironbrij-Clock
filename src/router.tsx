import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Without this, a failed background query (dropped connection, a
  // transient 5xx, a token hiccup) just leaves `data` undefined with no
  // signal anywhere — every list view in the app only ever branches on
  // "is this empty," so a real failure renders identically to genuinely
  // having nothing to show. This doesn't replace per-view handling, it's
  // the floor: whatever else happens, the person finds out something
  // didn't load. Guarded to the browser — this factory also runs during
  // SSR, where sonner's toast store exists but nothing will ever render it.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (typeof window === "undefined") return;
        toast.error("Couldn't load the latest data", {
          id: "query-error",
          description:
            error instanceof Error ? error.message : "Check your connection and try again.",
        });
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
