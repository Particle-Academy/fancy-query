/**
 * Inertia-only entry — `@particle-academy/fancy-query/inertia`.
 *
 * Lives on its own subpath (not the root barrel) because it statically
 * imports `@inertiajs/react`, which is an OPTIONAL peer: bundling it into
 * the root entry would make every non-Inertia consumer (e.g. a plain Vite
 * app) fail to resolve `@inertiajs/react` at build time.
 */
export { useInertiaHydration } from "./useInertiaHydration";
export type {
  InertiaHydrationMap,
  UseInertiaHydrationOptions,
} from "./useInertiaHydration";
