import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useFancyQuery } from "./useFancyQuery";
import { useEchoClient } from "./FancyDataRoot";
import { resolveChannel } from "./channel";
import type { EchoLike } from "./types";

/**
 * Reduce a streamed channel event into the cached query data. Return the next
 * cache value (immutably). `event` is the raw Echo payload.
 */
export type StreamReducer<TData, TEvent = any> = (
  cache: TData | undefined,
  event: TEvent,
) => TData;

export interface UseFancyStreamOptions<TData> {
  /** Channel to subscribe to — same prefix rules as `useFancyEchoInvalidation` (`private-`, `presence-`, bare). */
  channel: string;
  /** Seed the cache once on mount (and on `refetch` / poll recovery). */
  fetchInitial: () => Promise<TData>;
  /** Map of channel-event name → a reducer that patches the cache in place. */
  on: Record<string, StreamReducer<TData>>;
  /**
   * Which events flip `isStreaming`. Defaults to `{ startEvent: "stream.started",
   * endEvent: "stream.completed" }`. Pass `false` to never track streaming state.
   * (These events may also appear in `on` with their own reducers.)
   */
  streaming?: { startEvent?: string; endEvent?: string } | false;
  /**
   * Recover missed broadcasts by re-fetching `fetchInitial`. `while: "streaming"`
   * polls only between the start/end events; `"always"` polls whenever enabled.
   */
  poll?: { while?: "streaming" | "always"; intervalMs: number };
  /** Gate the subscription + query without unmounting. Default `true`. */
  enabled?: boolean;
  /** Pass an Echo client explicitly instead of reading it from `FancyDataRoot`. */
  echo?: EchoLike | null;
}

export interface UseFancyStreamResult<TData> {
  data: TData | undefined;
  /** True between the streaming start + end events. */
  isStreaming: boolean;
  isLoading: boolean;
  error: Error | null;
  /** Re-fetch `fetchInitial` and reconcile the cache (also the poll-recovery path). */
  refetch: () => void;
  /** Optimistically push an item into an array-shaped cache before the server echoes it back. */
  append: (item: unknown) => void;
  /** Imperatively patch the cache (e.g. an optimistic local message). */
  setData: (updater: (prev: TData | undefined) => TData) => void;
}

const DEFAULT_STREAMING = { startEvent: "stream.started", endEvent: "stream.completed" };

/**
 * The streaming counterpart to {@link useFancyEchoInvalidation}: instead of
 * invalidate-and-refetch, it maps Echo channel events onto `setQueryData`
 * reducers so the cache is patched **in place** — append a streamed post,
 * reconcile on completion — without dropping optimistic / in-flight state.
 *
 *   const { data, isStreaming, append } = useFancyStream(["chat", chatId], {
 *     channel: `chat.${chatId}`,
 *     fetchInitial: () => api.get(`/api/chat/${chatId}/history`),
 *     on: {
 *       "post.created":     (cache, e) => [...(cache ?? []), e.post],
 *       "stream.completed": (cache, e) => reconcile(cache, e),
 *     },
 *     poll: { while: "streaming", intervalMs: 4000 },
 *   });
 *
 * The Echo connection is owned by the consumer (via `FancyDataRoot` or `echo`).
 */
export function useFancyStream<TData = unknown>(
  queryKey: QueryKey,
  options: UseFancyStreamOptions<TData>,
): UseFancyStreamResult<TData> {
  const { channel, fetchInitial, on, poll, enabled = true } = options;
  const streaming =
    options.streaming === false
      ? null
      : {
          startEvent: options.streaming?.startEvent ?? DEFAULT_STREAMING.startEvent,
          endEvent: options.streaming?.endEvent ?? DEFAULT_STREAMING.endEvent,
        };

  const queryClient = useQueryClient();
  const contextEcho = useEchoClient();
  const echo = options.echo ?? contextEcho;

  const query = useFancyQuery<TData>(queryKey, fetchInitial, { enabled });
  const [isStreaming, setIsStreaming] = useState(false);

  // Latest reducers / config / key / refetch live in refs so swapping a fresh
  // `on` object (or key) each render doesn't tear down + rebuild the subscription.
  const onRef = useRef(on);
  onRef.current = on;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  const setData = useCallback<UseFancyStreamResult<TData>["setData"]>(
    (updater) => {
      queryClient.setQueryData<TData>(keyRef.current, (prev) => updater(prev));
    },
    [queryClient],
  );

  const append = useCallback<UseFancyStreamResult<TData>["append"]>(
    (item) => {
      setData((prev) => (Array.isArray(prev) ? ([...prev, item] as TData) : (prev as TData)));
    },
    [setData],
  );

  // Re-subscribe only when the channel, the *set of* event names, the key, or
  // the Echo client changes — not on every reducer-object identity change.
  const eventsKey = Object.keys(on).join(",");
  const queryKeyStr = JSON.stringify(queryKey);

  useEffect(() => {
    if (!echo || !enabled) {
      return;
    }
    const { subscribe, bareName } = resolveChannel(echo, channel);
    const subscribedChannel = subscribe();

    const events = new Set(Object.keys(onRef.current));
    const s = streamingRef.current;
    if (s) {
      events.add(s.startEvent);
      events.add(s.endEvent);
    }

    const handlers: Array<[string, (payload: unknown) => void]> = [];
    for (const event of events) {
      const handler = (payload: unknown) => {
        const reducer = onRef.current[event];
        if (reducer) {
          queryClient.setQueryData<TData>(keyRef.current, (prev) => reducer(prev, payload));
        }
        const sc = streamingRef.current;
        if (sc) {
          if (event === sc.startEvent) setIsStreaming(true);
          if (event === sc.endEvent) setIsStreaming(false);
        }
      };
      subscribedChannel.listen(event, handler);
      handlers.push([event, handler]);
    }

    return () => {
      for (const [event, handler] of handlers) {
        subscribedChannel.stopListening?.(event, handler);
      }
      echo.leave?.(bareName);
    };
    // reducers/config captured via refs; deps are the structural identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echo, enabled, channel, eventsKey, queryKeyStr, queryClient]);

  // Missed-broadcast recovery: re-fetch on an interval while streaming (or always).
  useEffect(() => {
    if (!poll || !enabled) {
      return;
    }
    const active = poll.while === "always" || isStreaming;
    if (!active) {
      return;
    }
    const id = setInterval(() => void refetchRef.current(), poll.intervalMs);
    return () => clearInterval(id);
  }, [poll?.intervalMs, poll?.while, isStreaming, enabled]);

  return {
    data: query.data,
    isStreaming,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: () => void query.refetch(),
    append,
    setData,
  };
}
