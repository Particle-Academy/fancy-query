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
} from "./useFancyStream";
export { useInertiaHydration } from "./useInertiaHydration";
export type {
  InertiaHydrationMap,
  UseInertiaHydrationOptions,
} from "./useInertiaHydration";

// Shared types + helpers
export { toQueryKeys } from "./keys";
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
