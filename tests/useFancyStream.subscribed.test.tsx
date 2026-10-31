import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FancyDataRoot } from "../src/FancyDataRoot";
import { useFancyStream } from "../src/useFancyStream";
import { createSocketEcho, type SocketEcho } from "../src/socket";
import type { EchoChannelLike, EchoLike } from "../src/types";

/**
 * Missed-event recovery on (re)subscription.
 *
 * Events published while the socket is down are never replayed, so the README
 * tells consumers to refetch authoritative state on every subscription
 * acknowledgement. useFancyStream has to do that itself: a consumer using the
 * hook has no channel handle to hang a `subscribed()` callback on.
 */

class TestSocket extends EventTarget {
  readyState = 1;
  closed = false;
  send() {}
  close() { this.closed = true; this.readyState = 3; }
  message(event: string, data: unknown, channel?: string) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event, data: JSON.stringify(data), channel }) }));
  }
  established(id = "1.2") { this.message("pusher:connection_established", { socket_id: id, activity_timeout: 120 }); }
  ack(channel: string) { this.message("pusher_internal:subscription_succeeded", {}, channel); }
  serverClose(code: number) { this.dispatchEvent(new CloseEvent("close", { code })); }
}

function Stream({ fetchInitial, echo }: { fetchInitial: () => Promise<unknown>; echo: EchoLike }) {
  useFancyStream(["room"], { channel: "room", fetchInitial, echo, on: { ".changed": (cache) => cache } });
  return null;
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useFancyStream — refetch on subscription acknowledgement", () => {
  let echo: SocketEcho;
  let sockets: TestSocket[];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sockets = [];
    echo = createSocketEcho({ url: "wss://socket.test/app/key", namespace: false, createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
  });
  afterEach(() => { echo.disconnect(); vi.useRealTimers(); });

  it("the initial acknowledgement refetches once — closing the seed-to-subscribe gap", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    const view = render(<FancyDataRoot echo={echo}><Stream fetchInitial={fetchInitial} echo={echo} /></FancyDataRoot>);
    await settle();
    expect(fetchInitial).toHaveBeenCalledTimes(1); // the seed

    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    await settle();
    expect(fetchInitial).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("a resubscribe after a socket drop triggers exactly one refetch", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    const view = render(<FancyDataRoot echo={echo}><Stream fetchInitial={fetchInitial} echo={echo} /></FancyDataRoot>);
    await settle();
    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    await settle();
    const beforeDrop = fetchInitial.mock.calls.length;

    await act(async () => { sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000); });
    expect(sockets).toHaveLength(2);
    await act(async () => { sockets[1].established("3.4"); sockets[1].ack("room"); });
    await settle();

    expect(fetchInitial.mock.calls.length - beforeDrop).toBe(1);
    // The recovery fetch reconciles against the current cache (merge-capable).
    expect(fetchInitial.mock.calls.at(-1)).toEqual([[]]);
    view.unmount();
  });

  it("unmounting removes the listener: a later acknowledgement refetches nothing", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    // A second consumer keeps the shared channel alive after the hook leaves.
    const other = echo.channel("room");
    const view = render(<FancyDataRoot echo={echo}><Stream fetchInitial={fetchInitial} echo={echo} /></FancyDataRoot>);
    await settle();
    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    await settle();
    view.unmount();
    const atUnmount = fetchInitial.mock.calls.length;

    await act(async () => { sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { sockets[1].established("3.4"); sockets[1].ack("room"); });
    await settle();

    expect(fetchInitial).toHaveBeenCalledTimes(atUnmount);
    expect(other).toBeDefined();
    echo.leave("room");
  });
});

describe("useFancyStream — EchoLike channels other than the first-party client", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  /** A channel shaped like laravel-echo's: `subscribed()` wraps the callback, so it cannot be unbound. */
  function echoWith(channel: EchoChannelLike): EchoLike {
    return { channel: () => channel, private: () => channel, leave: () => {} };
  }

  it("a channel without subscribed() does not throw and keeps today's behaviour", async () => {
    const channel: EchoChannelLike = { listen() { return channel; }, stopListening() { return channel; } };
    const echo = echoWith(channel);
    const fetchInitial = vi.fn().mockResolvedValue([]);
    const view = render(<FancyDataRoot echo={echo}><Stream fetchInitial={fetchInitial} echo={echo} /></FancyDataRoot>);
    await settle();
    expect(fetchInitial).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("a laravel-echo style subscribed() refetches per acknowledgement and is inert after unmount", async () => {
    const acks: Array<() => void> = [];
    const channel: EchoChannelLike & { subscribed(cb: () => void): EchoChannelLike } = {
      listen() { return channel; },
      stopListening() { return channel; },
      subscribed(cb) { acks.push(() => cb()); return channel; },
    };
    const echo = echoWith(channel);
    const fetchInitial = vi.fn().mockResolvedValue([]);
    const view = render(<FancyDataRoot echo={echo}><Stream fetchInitial={fetchInitial} echo={echo} /></FancyDataRoot>);
    await settle();
    expect(acks).toHaveLength(1);

    await act(async () => { acks[0](); });
    await settle();
    expect(fetchInitial).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => { acks[0](); });
    await settle();
    expect(fetchInitial).toHaveBeenCalledTimes(2);
  });
});
