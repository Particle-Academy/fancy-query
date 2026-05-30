import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePage } from "@inertiajs/react";
import { toQueryKeys } from "./keys";
import type { KeyInput } from "./types";

/** Inertia page-prop name → the query key to seed it into. */
export type InertiaHydrationMap = Record<string, KeyInput>;

export interface UseInertiaHydrationOptions {
  /**
   * When true (default), only seed a key the cache doesn't already hold — so a
   * fresher client value isn't clobbered by a re-sent page prop. Set false to
   * always overwrite from props.
   */
  preferCache?: boolean;
}

/**
 * Seed the query cache from Inertia page props so the first render is hydrated
 * and no initial fetch is needed:
 *
 *   // page received ['tools' => $tools] as a prop
 *   useInertiaHydration({ tools: ["org-tools"] });
 *
 * Re-seeds when the page props change (Inertia partial reloads). Requires the
 * `@inertiajs/react` peer — only import this hook in an Inertia app.
 */
export function useInertiaHydration(
  map: InertiaHydrationMap,
  options: UseInertiaHydrationOptions = {},
): void {
  const queryClient = useQueryClient();
  const props = usePage().props as Record<string, unknown>;
  const preferCache = options.preferCache ?? true;
  const mapKey = JSON.stringify(map);

  useEffect(() => {
    for (const [prop, key] of Object.entries(map)) {
      const value = props[prop];
      if (value === undefined) {
        continue;
      }
      const [queryKey] = toQueryKeys([key]);
      if (preferCache && queryClient.getQueryData(queryKey) !== undefined) {
        continue;
      }
      queryClient.setQueryData(queryKey, value);
    }
    // `map` captured via `mapKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, mapKey, preferCache, queryClient]);
}
