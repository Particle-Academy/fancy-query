import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

/**
 * Query defaults tuned for Inertia / Reverb apps. Override per-query at the call
 * site, or globally via {@link createFancyQueryClient}.
 *
 * - `staleTime: 30s` — data is "fresh" for 30s; no refetch storm on remounts.
 * - `gcTime: 5m` — unused cache entries are dropped after 5 minutes.
 * - `refetchOnWindowFocus` — pick up changes when the user returns to the tab.
 * - `retry: 1` — one retry on a network error, then surface it.
 */
export const FANCY_QUERY_DEFAULTS = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  retry: 1,
} as const;

/**
 * Build a {@link QueryClient} with the Fancy defaults applied. Pass a
 * {@link QueryClientConfig} to override (your `defaultOptions.queries` merge on
 * top of {@link FANCY_QUERY_DEFAULTS}).
 */
export function createFancyQueryClient(config?: QueryClientConfig): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config?.defaultOptions,
      queries: {
        ...FANCY_QUERY_DEFAULTS,
        ...config?.defaultOptions?.queries,
      },
    },
  });
}
