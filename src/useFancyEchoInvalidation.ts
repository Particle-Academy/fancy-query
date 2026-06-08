import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toQueryKeys } from "./keys";
import { useEchoClient } from "./FancyDataRoot";
import { resolveChannel } from "./channel";
import type { EchoInvalidationMap, EchoLike } from "./types";

export interface UseFancyEchoInvalidationOptions {
  /** Pass an Echo client explicitly instead of reading it from FancyDataRoot. */
  echo?: EchoLike | null;
  /** Gate the subscription without unmounting (e.g. while `orgId` is undefined). */
  enabled?: boolean;
}

/**
 * Subscribe to a channel and invalidate query keys when named events fire:
 *
 *   useFancyEchoInvalidation(`private-org.${orgId}`, {
 *     CompassToolUpdated: ["org-tools", "org-tool-slots"],
 *     CompassToolDeleted: ["org-tools", "org-tool-slots"],
 *   });
 *
 * Each listed key is invalidated separately. The channel name carries its
 * prefix (`private-` / `presence-`); it maps to `echo.private()` /
 * `echo.join()` / `echo.channel()`, and `echo.leave()` on cleanup. The Echo
 * connection is owned by the consumer.
 *
 * NOTE: event names are passed to Echo's `listen()` as written. If you broadcast
 * with a custom `broadcastAs()` name, listen on its dotted form (`.OrderShipped`)
 * — same as raw Echo. (A normalization helper is a follow-up; see Tynn.)
 */
export function useFancyEchoInvalidation(
  channel: string,
  events: EchoInvalidationMap,
  options: UseFancyEchoInvalidationOptions = {},
): void {
  const queryClient = useQueryClient();
  const contextEcho = useEchoClient();
  const echo = options.echo ?? contextEcho;
  const enabled = options.enabled ?? true;

  // Re-subscribe only when the event→keys map actually changes (not on every
  // render that passes a fresh object literal).
  const eventsKey = JSON.stringify(events);

  useEffect(() => {
    if (!echo || !enabled) {
      return;
    }

    const { subscribe, bareName } = resolveChannel(echo, channel);
    const subscribedChannel = subscribe();
    const handlers: Array<[string, (payload: unknown) => void]> = [];

    for (const [event, keys] of Object.entries(events)) {
      const handler = () => {
        for (const queryKey of toQueryKeys(keys)) {
          void queryClient.invalidateQueries({ queryKey });
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
    // `events` is captured via the serialized `eventsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echo, enabled, channel, eventsKey, queryClient]);
}
