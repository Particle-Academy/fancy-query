import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

/**
 * Thin wrapper over `useQuery`. The Fancy defaults come from the QueryClient
 * (see {@link createFancyQueryClient}); this just gives the ergonomic
 * `(key, fn, options?)` signature while passing the full options object through
 * — `select`, `enabled`, `placeholderData`, etc. all work.
 *
 *   const { data: tools } = useFancyQuery(["org-tools", filters], () =>
 *     api.get("/api/org/compass-tools", { filters }),
 *   );
 *
 * A second component reading the same key in the same render gets the cached
 * result with no extra request — that's the whole point.
 */
export function useFancyQuery<
  TData = unknown,
  TError = Error,
  TKey extends QueryKey = QueryKey,
>(
  queryKey: TKey,
  queryFn: () => Promise<TData>,
  options?: Omit<
    UseQueryOptions<TData, TError, TData, TKey>,
    "queryKey" | "queryFn"
  >,
): UseQueryResult<TData, TError> {
  return useQuery<TData, TError, TData, TKey>({ queryKey, queryFn, ...options });
}
