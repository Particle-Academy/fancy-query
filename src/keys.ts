import type { QueryKey } from "@tanstack/react-query";
import type { KeyInput } from "./types";

/**
 * Normalize a list of {@link KeyInput}s into concrete {@link QueryKey}s — each
 * one invalidated separately. A bare string becomes a one-segment key, so
 * `["org-tools", "org-tool-slots"]` invalidates `["org-tools"]` AND
 * `["org-tool-slots"]` (TanStack matches by key prefix). To invalidate a single
 * compound key, pass it as an array: `[["org", orgId, "tools"]]`.
 */
export function toQueryKeys(keys: readonly KeyInput[] | undefined): QueryKey[] {
  if (!keys) {
    return [];
  }

  return keys.map((key) => (Array.isArray(key) ? (key as QueryKey) : [key]));
}
