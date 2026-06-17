import { useMemo } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useFancyStream, type UseFancyStreamOptions, type UseFancyStreamResult } from "./useFancyStream";

/**
 * A sort spec — either a raw comparator, or a `{ by, dir }` accessor (the common
 * case: pick a comparable field and a direction).
 */
export type FancyTableSort<TItem> =
  | ((a: TItem, b: TItem) => number)
  | { by: (item: TItem) => string | number | Date; dir?: "asc" | "desc" };

export interface UseFancyTableOptions<TItem>
  extends Omit<UseFancyStreamOptions<TItem[]>, "fetchInitial"> {
  /** Seed the live collection. Receives the previous rows so a poll can merge. */
  fetchInitial: (prev?: TItem[]) => Promise<TItem[]>;
  /** Keep only rows that pass — applied to the VIEW; the cache stays whole. */
  filter?: (item: TItem) => boolean;
  /** Order the VIEW. Comparator or `{ by, dir }`. */
  sort?: FancyTableSort<TItem>;
  /** Cap the VIEW to the first N rows (after filter + sort). The cache stays whole. */
  limit?: number;
}

export interface UseFancyTableResult<TItem>
  extends Omit<UseFancyStreamResult<TItem[]>, "data"> {
  /** The derived view: filtered → sorted → limited. */
  rows: TItem[];
  /** The full live collection (escape hatch — before filter/sort/limit). */
  all: TItem[];
  /** `rows.length`. */
  count: number;
  /** `all.length` — the full collection size, ignoring `limit`. */
  total: number;
}

function toComparator<TItem>(sort: FancyTableSort<TItem>): (a: TItem, b: TItem) => number {
  if (typeof sort === "function") return sort;
  const { by, dir = "asc" } = sort;
  const mul = dir === "desc" ? -1 : 1;
  return (a, b) => {
    const av = by(a);
    const bv = by(b);
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  };
}

function applyView<TItem>(
  all: TItem[],
  filter?: (item: TItem) => boolean,
  sort?: FancyTableSort<TItem>,
  limit?: number,
): TItem[] {
  let rows = filter ? all.filter(filter) : all;
  if (sort) {
    // Copy before sorting so we never mutate the cached array in place.
    rows = [...rows].sort(toComparator(sort));
  }
  if (typeof limit === "number" && rows.length > limit) {
    rows = rows.slice(0, limit);
  }
  return rows;
}

/**
 * Headless **live data-table** binding — the collection counterpart to a
 * single-object stream. Subscribes a whole collection over Echo via
 * {@link useFancyStream} (your `on` reducers maintain the canonical live array),
 * then derives a **view** with client-side `filter` / `sort` / `limit`. A row
 * filtered out now reappears when it later matches — the cache always holds the
 * full set; only the view changes.
 *
 *   const { rows } = useFancyTable<ActiveUser>(["active-users"], {
 *     channel: "active-users",
 *     fetchInitial: () => fetch("/active-users").then((r) => r.json()),
 *     on: { "active-user.updated": upsertById },
 *     filter: (u) => u.last_active_at >= cutoff,
 *     sort: { by: (u) => u.activity_at, dir: "desc" },
 *     limit: 12,
 *     streaming: false,
 *   });
 *
 * This is a thin wrapper, not a rewrite: `useFancyStream` owns *how the cache is
 * maintained*; `useFancyTable` owns *how the caller views it*.
 */
export function useFancyTable<TItem>(
  queryKey: QueryKey,
  options: UseFancyTableOptions<TItem>,
): UseFancyTableResult<TItem> {
  const { filter, sort, limit, ...streamOptions } = options;
  const stream = useFancyStream<TItem[]>(queryKey, streamOptions);

  const all = stream.data ?? [];
  const rows = useMemo(
    () => applyView(all, filter, sort, limit),
    // `all` identity changes whenever the cache array is rewritten; filter/sort
    // are typically inline so we depend on their references too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, filter, sort, limit],
  );

  return {
    rows,
    all,
    count: rows.length,
    total: all.length,
    isStreaming: stream.isStreaming,
    isLoading: stream.isLoading,
    error: stream.error,
    refetch: stream.refetch,
    append: stream.append,
    setData: stream.setData,
  };
}
