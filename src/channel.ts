import type { EchoChannelLike, EchoLike } from "./types";

/**
 * Map a prefixed channel name to the right Echo subscription + its bare name.
 *
 *   "private-org.7"  → echo.private("org.7")     bareName "org.7"
 *   "presence-room.3"→ echo.join("room.3")       bareName "room.3"
 *   "chat.42"        → echo.channel("chat.42")   bareName "chat.42"
 *
 * Shared by {@link useFancyEchoInvalidation} and {@link useFancyStream} so the
 * subscription/cleanup semantics stay identical.
 */
export function resolveChannel(
  echo: EchoLike,
  channel: string,
): { subscribe: () => EchoChannelLike; bareName: string } {
  if (channel.startsWith("private-")) {
    const name = channel.slice("private-".length);
    return { subscribe: () => echo.private(name), bareName: name };
  }
  if (channel.startsWith("presence-")) {
    const name = channel.slice("presence-".length);
    return { subscribe: () => (echo.join ?? echo.channel).call(echo, name), bareName: name };
  }
  return { subscribe: () => echo.channel(channel), bareName: channel };
}
