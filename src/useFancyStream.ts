import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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

/** Imperative helpers handed to {@link UseFancyStreamOptions.onEvent}. */
export interface StreamEventContext<TData> {
  /** Patch the cache imperatively. */
  setData: (updater: (prev: TData | undefined) => TData) => void;
  /** Re-fetch `fetchInitial(prev)` and reconcile (merge-capable; replace by default). */
  refetch: () => void;
  /** Optimistically push an item into an array-shaped cache. */
  append: (item: unknown) => void;
}

export interface UseFancyStreamOptions<TData> {
  /** Channel to subscribe to — same prefix rules as `useFancyEchoInvalidation` (`private-`, `presence-`, bare). */
  channel: string;
  /**
   * Seed the cache. Receives the PREVIOUS cache so a poll / recovery fetch can
   * **merge** (preserve optimistic rows) instead of replacing — return the
   * reconciled value. `prev` is `undefined` on the first load.
   */
  fetchInitial: (prev?: TData) => Promise<TData>;
  /** Map of channel-event name → a reducer that patches the cache in place. */
  on?: Record<string, StreamReducer<TData>>;
  /**
   * Side-effect handler called for **every** subscribed event — the keys of
   * `on`, the streaming start/end events, and any names in `events`. Runs
   * outside the cache reducer, so it's the place for `window` CustomEvents,
   * transient UI state, async reconciles, etc.
   */
  onEvent?: (event: string, payload: any, ctx: StreamEventContext<TData>) => void;
  /** Extra event names to subscribe to for `onEvent` only (no cache reducer). */
  events?: string[];
  /**
   * Which events flip `isStreaming`. Each side accepts one name or a list — so
   * a turn can end on `stream.completed` **or** `stream.failed`. Defaults to
   * `{ startEvent: "stream.started", endEvent: "stream.completed" }`. Pass
   * `false` to never track streaming state.
   */
  streaming?: { startEvent?: string | string[]; endEvent?: string | string[] } | false;
  /**
   * Missed-broadcast recovery. Re-fetches `fetchInitial(prev)` on an interval
   * (`while: "streaming"` polls only between the start/end events; `"always"`
   * whenever enabled). Pass `commit(next, prev)` to gate whether the refetch is
   * applied — e.g. only commit when the turn is actually done — so an in-flight
   * stream isn't clobbered; merge via `fetchInitial`'s `prev` arg to keep
   * optimistic rows.
   */
  poll?: {
    while?: "streaming" | "always";
    intervalMs: number;
    commit?: (next: TData, prev: TData | undefined) => boolean;
  };
  /**
   * Wrap cache writes in React's `flushSync` so streamed events paint
   * immediately (React batches updates from non-React sources like Echo).
   */
  flushSync?: boolean;
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
  /** Re-fetch `fetchInitial(prev)` and reconcile (merge-capable; replace by default). */
  refetch: () => void;
  /** Optimistically push an item into an array-shaped cache before the server echoes it back. */
  append: (item: unknown) => void;
  /** Imperatively patch the cache (e.g. an optimistic local message). */
  setData: (updater: (prev: TData | undefined) => TData) => void;
}

const DEFAULT_START = "stream.started";
const DEFAULT_END = "stream.completed";

const toArray = (v: string | string[] | undefined, fallback: string): string[] =>
  v === undefined ? [fallback] : Array.isArray(v) ? v : [v];

/**
 * The streaming counterpart to {@link useFancyEchoInvalidation}: instead of
 * invalidate-and-refetch, it maps Echo channel events onto `setQueryData`
 * reducers so the cache is patched **in place** — append a streamed post,
 * reconcile on completion — without dropping optimistic / in-flight state.
 *
 *   const { data, isStreaming, append } = useFancyStream(["chat", chatId], {
 *     channel: `private-chat.${chatId}`,
 *     fetchInitial: (prev) => reconcileHistory(prev, await api.history(chatId)),
 *     on: { "post.created": (cache, e) => [...(cache ?? []), e.post] },
 *     onEvent: (event, payload, { setData, refetch }) => {
 *       if (event === "stream.failed") refetch();            // side effects
 *     },
 *     streaming: { endEvent: ["stream.completed", "stream.failed"] },
 *     poll: { while: "streaming", intervalMs: 4000, commit: (next) => turnDone(next) },
 *     flushSync: true,
 *   });
 *
 * The Echo connection is owned by the consumer (via `FancyDataRoot` or `echo`).
 */
export function useFancyStream<TData = unknown>(
  queryKey: QueryKey,
  options: UseFancyStreamOptions<TData>,
): UseFancyStreamResult<TData> {
  const { channel, fetchInitial, on = {}, poll, enabled = true } = options;
  const streaming =
    options.streaming === false
      ? null
      : {
          start: toArray(options.streaming?.startEvent, DEFAULT_START),
          end: toArray(options.streaming?.endEvent, DEFAULT_END),
        };

  const queryClient = useQueryClient();
  const contextEcho = useEchoClient();
  const echo = options.echo ?? contextEcho;

  // Latest config lives in refs so swapping a fresh option object each render
  // doesn't tear down + rebuild the subscription.
  const fetchInitialRef = useRef(fetchInitial);
  fetchInitialRef.current = fetchInitial;
  const onRef = useRef(on);
  onRef.current = on;
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const extraEventsRef = useRef(options.events);
  extraEventsRef.current = options.events;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const flushRef = useRef(options.flushSync ?? false);
  flushRef.current = options.flushSync ?? false;
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;

  // Seed the cache once (prev = undefined on first load). Streaming surfaces
  // don't want a focus-refetch silently replacing in-flight streamed state.
  const seed = useCallback(() => fetchInitialRef.current(undefined), []);
  const query = useFancyQuery<TData>(queryKey, seed, { enabled, refetchOnWindowFocus: false });
  const [isStreaming, setIsStreaming] = useState(false);

  const write = useCallback((fn: () => void) => {
    if (flushRef.current) flushSync(fn);
    else fn();
  }, []);

  const setData = useCallback<UseFancyStreamResult<TData>["setData"]>(
    (updater) => write(() => queryClient.setQueryData<TData>(keyRef.current, (prev) => updater(prev))),
    [queryClient, write],
  );

  const append = useCallback<UseFancyStreamResult<TData>["append"]>(
    (item) => setData((prev) => (Array.isArray(prev) ? ([...prev, item] as TData) : (prev as TData))),
    [setData],
  );

  // Re-fetch + reconcile: the consumer can merge via `fetchInitial(prev)`, and
  // `poll.commit` gates whether the result is applied. With no commit + a
  // replace-style fetchInitial this is a plain refetch — backward compatible.
  const reconcile = useCallback(async () => {
    const prev = queryClient.getQueryData<TData>(keyRef.current);
    const next = await fetchInitialRef.current(prev);
    const commit = pollRef.current?.commit;
    if (!commit || commit(next, prev)) {
      write(() => queryClient.setQueryData<TData>(keyRef.current, next));
    }
  }, [queryClient, write]);

  const refetch = useCallback(() => void reconcile(), [reconcile]);

  const ctxRef = useRef<StreamEventContext<TData>>({ setData, refetch, append });
  ctxRef.current = { setData, refetch, append };

  // Re-subscribe only when the channel, the *set of* event names (reducers +
  // extra `events` + streaming start/end), the key, or the Echo client changes.
  const eventsKey = [
    Object.keys(on).join(","),
    (options.events ?? []).join(","),
    JSON.stringify(options.streaming),
  ].join("|");
  const queryKeyStr = JSON.stringify(queryKey);

  useEffect(() => {
    if (!echo || !enabled) {
      return;
    }
    const { subscribe, bareName } = resolveChannel(echo, channel);
    const subscribedChannel = subscribe();

    const events = new Set<string>([...Object.keys(onRef.current), ...(extraEventsRef.current ?? [])]);
    const s = streamingRef.current;
    if (s) {
      s.start.forEach((e) => events.add(e));
      s.end.forEach((e) => events.add(e));
    }

    const handlers: Array<[string, (payload: unknown) => void]> = [];
    for (const event of events) {
      const handler = (payload: unknown) => {
        write(() => {
          const reducer = onRef.current[event];
          if (reducer) {
            queryClient.setQueryData<TData>(keyRef.current, (prev) => reducer(prev, payload));
          }
          const sc = streamingRef.current;
          if (sc) {
            if (sc.start.includes(event)) setIsStreaming(true);
            if (sc.end.includes(event)) setIsStreaming(false);
          }
        });
        // Side effects run after the cache write (so they can read the fresh cache).
        onEventRef.current?.(event, payload, ctxRef.current);
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
  }, [echo, enabled, channel, eventsKey, queryKeyStr, queryClient, write]);

  // Missed-broadcast recovery — reconcile on an interval while streaming (or always).
  useEffect(() => {
    if (!poll || !enabled) {
      return;
    }
    const active = poll.while === "always" || isStreaming;
    if (!active) {
      return;
    }
    const id = setInterval(() => void reconcile(), poll.intervalMs);
    return () => clearInterval(id);
  }, [poll?.intervalMs, poll?.while, isStreaming, enabled, reconcile]);

  return {
    data: query.data,
    isStreaming,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch,
    append,
    setData,
  };
}
