# Changelog

## 0.7.0 — 2026-08-07

### Changed

- **BREAKING — Node 22 is now declared as the floor.** `engines.node` is `>=22`, where this package previously declared **nothing at all**.

  Declaring nothing was not the same as supporting old Node: a consumer on 18 installed cleanly and found out at runtime.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

- **BREAKING — React 18 is no longer supported.** `peerDependencies.react` / `react-dom` are now `^19.0.0`.

  **What you must do:** on React 19, nothing. On React 18, stay on the previous release, or upgrade your app to 19 first.

  React 18 support was a claim nothing tested — every build and test in this package ran against 19, so the 18 half of the old range was never executed. An untested compatibility claim is worse than an absent one, because it reads as support.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.

## 0.6.0 — 2026-07-25

### Added
- **`poll.while` accepts a predicate** — `"streaming" | "always" | (() => boolean)`
  ([#4](https://github.com/Particle-Academy/fancy-query/issues/4)).

  `while: "streaming"` only starts polling once `stream.started` has been
  **received**, which makes missed-broadcast recovery depend on receiving a
  broadcast. Drop that one event and a long turn never polls; drop the end event
  too and it is stranded with no indicator and no recovery. `"always"` was the
  only escape, and it polls when idle — not viable for a per-chat endpoint.

  A predicate lets recovery run off your own in-flight state, set the moment the
  user sends, independent of any broadcast:

  ```ts
  poll: {
    while: () => isProcessingRef.current,
    intervalMs: 4000,
    commit: (next) => next?.history?.at(-1)?.role === "assistant",
  }
  ```

  The predicate is **re-read on every tick**, so backing it with a ref works —
  which is the point, since the flag has to change without a re-render.
  Evaluating it once would leave the poll stuck on whatever it read at mount.
  An inline arrow is also fine: its identity is deliberately kept out of the
  effect's deps, so re-rendering does not restart the interval.

  **Consumers need do nothing** — `while` still defaults to `"streaming"` and
  both existing string values behave exactly as before.

- **Tests.** This package had none; `npm test` now runs vitest, and CI already
  invoked `npm test --if-present`, so it wires in with no workflow change. The
  four cases pin the predicate contract, including the two failure modes that
  would otherwise regress in silence — a ref flip mid-turn being ignored, and an
  inline predicate restarting the interval on every render.

## 0.5.0 — 2026-07-06

### Breaking
- **`useInertiaHydration` moved to `@particle-academy/fancy-query/inertia`.**
  The root barrel re-exported it while it statically imports the *optional*
  `@inertiajs/react` peer — so every non-Inertia consumer (e.g. a plain Vite
  app importing only `FancyDataRoot` + `useFancyStream`) failed at build time
  with `Could not resolve "@inertiajs/react"`. The hook (and its
  `InertiaHydrationMap` / `UseInertiaHydrationOptions` types) now ships on its
  own entry; the root entry no longer references `@inertiajs/react` at all.
  Migration: `import { useInertiaHydration } from "@particle-academy/fancy-query/inertia"`.

## 0.4.0 — 2026-06-27

### Added
- **`useFancyTable`** — headless live data-table binding.

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
