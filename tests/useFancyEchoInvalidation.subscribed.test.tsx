import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { FancyDataRoot } from "../src/FancyDataRoot";
import { useFancyEchoInvalidation } from "../src/useFancyEchoInvalidation";
import { createSocketEcho, type SocketEcho } from "../src/socket";
import type { EchoChannelLike, EchoLike } from "../src/types";

/**
 * Missed-event recovery on (re)subscription, for the invalidation hook.
 *
 * Events published while the socket is down are never replayed, so on every
 * subscription acknowledgement the hook invalidates the keys it is configured
 * for — otherwise those queries stay stale until some unrelated event fires.
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

// Two events share "tools": a reconnect must invalidate each key once, not once per event.
const EVENTS = { ".tool.updated": ["tools", "slots"], ".tool.deleted": ["tools", ["org", 7]] } as const;

function Invalidation({ echo }: { echo: EchoLike }) {
  useFancyEchoInvalidation("room", EVENTS as never, { echo });
  return null;
}

function mount(echo: EchoLike) {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const view = render(<FancyDataRoot client={client} echo={echo}><Invalidation echo={echo} /></FancyDataRoot>);
  const invalidated = () => spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));
  return { view, spy, invalidated };
}

const ONE_ROUND = ['["tools"]', '["slots"]', '["org",7]'];

describe("useFancyEchoInvalidation — invalidate on subscription acknowledgement", () => {
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

  it("the initial acknowledgement invalidates every configured key exactly once", async () => {
    const { view, invalidated } = mount(echo);
    expect(invalidated()).toEqual([]);
    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    expect(invalidated()).toEqual(ONE_ROUND);
    view.unmount();
  });

  it("a resubscribe after a socket drop invalidates each key exactly once more", async () => {
    const { view, invalidated } = mount(echo);
    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    await act(async () => { sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000); });
    expect(sockets).toHaveLength(2);
    await act(async () => { sockets[1].established("3.4"); sockets[1].ack("room"); });
    expect(invalidated()).toEqual([...ONE_ROUND, ...ONE_ROUND]);
    view.unmount();
  });

  it("unmounting removes the listener: a later acknowledgement invalidates nothing", async () => {
    echo.channel("room"); // a second consumer keeps the shared channel alive
    const { view, spy } = mount(echo);
    await act(async () => { sockets[0].established(); sockets[0].ack("room"); });
    view.unmount();
    const atUnmount = spy.mock.calls.length;
    await act(async () => { sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { sockets[1].established("3.4"); sockets[1].ack("room"); });
    expect(spy).toHaveBeenCalledTimes(atUnmount);
    echo.leave("room");
  });
});

describe("useFancyEchoInvalidation — EchoLike channels other than the first-party client", () => {
  function echoWith(channel: EchoChannelLike): EchoLike {
    return { channel: () => channel, private: () => channel, leave: () => {} };
  }

  it("a channel without subscribed() does not throw and keeps today's behaviour", () => {
    const channel: EchoChannelLike = { listen() { return channel; }, stopListening() { return channel; } };
    const { view, spy } = mount(echoWith(channel));
    expect(spy).not.toHaveBeenCalled();
    view.unmount();
  });

  it("a laravel-echo style subscribed() invalidates per acknowledgement and is inert after unmount", async () => {
    const acks: Array<() => void> = [];
    const channel: EchoChannelLike & { subscribed(cb: () => void): EchoChannelLike } = {
      listen() { return channel; },
      stopListening() { return channel; },
      subscribed(cb) { acks.push(() => cb()); return channel; },
    };
    const { view, invalidated, spy } = mount(echoWith(channel));
    expect(acks).toHaveLength(1);
    await act(async () => { acks[0](); });
    expect(invalidated()).toEqual(ONE_ROUND);
    view.unmount();
    await act(async () => { acks[0](); });
    expect(spy).toHaveBeenCalledTimes(ONE_ROUND.length);
  });
});
