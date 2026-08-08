// Provider + client
export { FancyDataRoot, useEchoClient } from "./FancyDataRoot";
export type { FancyDataRootProps } from "./FancyDataRoot";
export { createFancyQueryClient, FANCY_QUERY_DEFAULTS } from "./client";

// Hooks
export { useFancyQuery } from "./useFancyQuery";
export { useFancyMutation } from "./useFancyMutation";
export type {
  UseFancyMutationOptions,
  FancyMutationInvalidates,
} from "./useFancyMutation";
export { useFancyEchoInvalidation } from "./useFancyEchoInvalidation";
export type { UseFancyEchoInvalidationOptions } from "./useFancyEchoInvalidation";
export { useFancyStream } from "./useFancyStream";
export type {
  UseFancyStreamOptions,
  UseFancyStreamResult,
  StreamReducer,
  StreamEventContext,
} from "./useFancyStream";
export { useFancyTable } from "./useFancyTable";
export type {
  UseFancyTableOptions,
  UseFancyTableResult,
  FancyTableSort,
} from "./useFancyTable";
// NOTE: `useInertiaHydration` intentionally does NOT live here. It statically
// imports the optional `@inertiajs/react` peer, so it ships on its own entry:
// `@particle-academy/fancy-query/inertia`.

// Shared types + helpers
export { toQueryKeys } from "./keys";

// The Live Contract — how a package declares which query keys its surface owns
// and which broadcast events invalidate them. `LiveContract` is a TYPE, so a
// package can declare its contract with `import type` and gain no dependency.
export { liveKey, toEchoMap, liveEventNames, validateLiveContract, LIVE_VERBS } from "./live";
export type { LiveContract, LiveEvent, LiveVerb } from "./live";
export type {
  KeyInput,
  EchoLike,
  EchoChannelLike,
  EchoInvalidationMap,
} from "./types";

// Re-export the TanStack primitives consumers reach for alongside the wrappers,
// so they don't need a second import for the common cases.
export { QueryClient, useQueryClient } from "@tanstack/react-query";
export type { QueryKey } from "@tanstack/react-query";
