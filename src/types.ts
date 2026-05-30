import type { QueryKey } from "@tanstack/react-query";

/**
 * A query key, or a bare string as shorthand for a single-segment key:
 * `"org-tools"` ≡ `["org-tools"]`.
 */
export type KeyInput = QueryKey | string;

/** Minimal shape of a Laravel Echo channel. fancy-query never constructs one. */
export interface EchoChannelLike {
  listen(event: string, callback: (payload: unknown) => void): EchoChannelLike;
  stopListening?(event: string, callback?: (payload: unknown) => void): EchoChannelLike;
}

/**
 * Minimal shape of a Laravel Echo client. The consumer brings their own; this
 * package never owns the connection — it only subscribes + invalidates.
 */
export interface EchoLike {
  channel(name: string): EchoChannelLike;
  private(name: string): EchoChannelLike;
  join?(name: string): EchoChannelLike;
  leave?(name: string): void;
}

/** Event name → the query keys to invalidate when that event fires. */
export type EchoInvalidationMap = Record<string, readonly KeyInput[]>;
