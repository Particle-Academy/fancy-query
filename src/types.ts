import type { QueryKey } from "@tanstack/react-query";

/**
 * A query key, or a bare string as shorthand for a single-segment key:
 * `"org-tools"` ≡ `["org-tools"]`.
 */
export type KeyInput = QueryKey | string;

/** Minimal shape shared by Laravel Echo and fancy-query/socket. */
export interface EchoChannelLike {
  listen(event: string, callback: (payload: unknown) => void): EchoChannelLike;
  stopListening?(event: string, callback?: (payload: unknown) => void): EchoChannelLike;
  /**
   * Called on every subscription acknowledgement, including each resubscribe
   * after a reconnect. Optional: a channel without it simply gets no
   * acknowledgement-driven refetch.
   */
  subscribed?(callback: (payload?: unknown) => void): EchoChannelLike;
}

/**
 * Minimal socket contract. The consumer owns the connection, using Laravel
 * Echo or the first-party createSocketEcho from fancy-query/socket.
 */
export interface EchoLike {
  channel(name: string): EchoChannelLike;
  private(name: string): EchoChannelLike;
  join?(name: string): EchoChannelLike;
  leave?(name: string): void;
}

/** Event name → the query keys to invalidate when that event fires. */
export type EchoInvalidationMap = Record<string, readonly KeyInput[]>;
