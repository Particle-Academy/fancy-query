# Changelog

## 0.1.0 — 2026-05-29 (scaffold, unreleased)

Initial scaffold of `@particle-academy/fancy-query` — server-state for
React + Inertia + Reverb apps, wrapping TanStack Query with the integrations.

### Added
- `FancyDataRoot` — mount-once provider (one `QueryClient` + optional Echo
  client via context).
- `createFancyQueryClient` / `FANCY_QUERY_DEFAULTS` — a `QueryClient` tuned for
  Inertia/Reverb (`staleTime: 30s`, `gcTime: 5m`, refetch-on-focus, one retry).
- `useFancyQuery(key, fn, options?)` — ergonomic `useQuery` wrapper; full options
  pass through.
- `useFancyMutation({ mutationFn, invalidates, … })` — `useMutation` that
  invalidates keys on success; everything else passes through.
- `useFancyEchoInvalidation(channel, eventMap, options?)` — declarative
  Echo-event → query-key invalidation; reads the Echo client from `FancyDataRoot`
  context (or an explicit `echo` option). Never owns the connection.
- `useInertiaHydration(map, options?)` — seed the cache from Inertia page props;
  re-seeds on partial-reload prop changes; `preferCache` guards fresher data.
- `toQueryKeys` helper + re-exported `QueryClient` / `useQueryClient` / `QueryKey`.

### Tracked next (Tynn)
- Per-hook tests (subscribe/unsubscribe, invalidation, hydration precedence,
  two-components-one-request dedupe).
- `fancy-inertia` `FancyAppRoot` `withData` composition (optional-peer).
- Echo `broadcastAs` dot-prefix event normalization.
- Ship/publish to npm.
