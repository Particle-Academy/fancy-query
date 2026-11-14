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
  /**
   * Presence channels only, all optional (laravel-echo's presence channel has
   * the same names). `here` gets every member's info on each subscription
   * acknowledgement, so it re-fires after a reconnect; `joining` and `leaving`
   * get one member's info. Member info is whatever the server's channel auth
   * returned, never something a peer claimed.
   */
  here?(callback: (members: unknown[]) => void): EchoChannelLike;
  joining?(callback: (member: unknown) => void): EchoChannelLike;
  leaving?(callback: (member: unknown) => void): EchoChannelLike;
  /**
   * Client events, private and presence channels only (the server must allow
   * them; Reverb and Pusher both gate them). `whisper` sends `client-<event>`;
   * `listenForWhisper` receives a peer's, with the server-stamped `userId` on a
   * presence channel. A peer can still put anything in the payload: treat it
   * as untrusted data.
   */
  whisper?(event: string, data: unknown): EchoChannelLike;
  listenForWhisper?(event: string, callback: (data: unknown, meta?: { userId?: string }) => void): EchoChannelLike;
  stopListeningForWhisper?(event: string, callback?: (data: unknown, meta?: { userId?: string }) => void): EchoChannelLike;
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
