# Changelog

## 0.3.0 — 2026-06-09

`useFancyStream` extensions for real chat / tool-execution state machines (#3,
follow-up to #2). All additive + backward-compatible.

### Added
- **`onEvent(event, payload, ctx)`** — a side-effect handler called for *every*
  subscribed event, outside the cache reducer. The place for `window`
  CustomEvents, transient UI state, async reconciles, etc. `ctx` is
  `{ setData, refetch, append }` (new `StreamEventContext` type).
- **`events: string[]`** — extra event names to subscribe to for `onEvent` only
  (no cache reducer).
- **Multiple terminal events** — `streaming.startEvent` / `endEvent` now accept
  `string | string[]`, so a turn can end on `stream.completed` **or**
  `stream.failed`.
- **Reconcile poll** — `fetchInitial` now receives the **previous cache**
  (`fetchInitial(prev)`) so a recovery poll can *merge* (preserve optimistic
  rows) instead of replacing. New `poll.commit(next, prev)` gates whether a
  refetch is applied — e.g. only commit when the turn is done — so an in-flight
  stream isn't clobbered. `refetch()` (top-level + in `ctx`) uses this path.
- **`flushSync: true`** — wrap cache writes in React's `flushSync` so streamed
  events paint immediately (React batches updates from non-React sources).

### Changed
- The stream query no longer refetches on window focus (it would silently
  replace in-flight streamed state). Recovery is via `poll` / `refetch()`.
- `on` is now optional (use `onEvent`-only streams).

## 0.2.0 — 2026-06-08

### Added
- `useFancyStream(key, options)` — the streaming counterpart to
  `useFancyEchoInvalidation`. Instead of invalidate-and-refetch, it maps Echo
  channel events onto `setQueryData` **reducers** so the cache is patched in
  place — append a streamed post, reconcile on completion — without dropping
  optimistic / in-flight state. Built for chat + agentic surfaces.
  - `on: { 'post.created': (cache, e) => [...cache, e.post], … }` — per-event
    reducers run through `queryClient.setQueryData`.
  - `isStreaming` tracked from configurable start/end events
    (default `stream.started` / `stream.completed`; pass `streaming: false` to
    opt out).
  - `poll: { while: 'streaming' | 'always', intervalMs }` — missed-broadcast
    recovery by re-fetching `fetchInitial` on an interval.
  - `append(item)` optimistic helper for array-shaped caches + an imperative
    `setData(updater)`.
  - Reuses the same channel-prefix resolution + connection ownership as
    `useFancyEchoInvalidation` (now shared via `src/channel.ts`).
- Exported types: `UseFancyStreamOptions`, `UseFancyStreamResult`,
  `StreamReducer`.

## 0.1.1 — 2026-06-06

### Fixed
- Widened peer ranges: `@inertiajs/react` to `^1 || ^2 || ^3` (and marked
  optional), `@tanstack/react-query` to `^5`, react/react-dom to `^18 || ^19`,
  so the package installs cleanly across consumer stacks.

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
