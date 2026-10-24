import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSocketEcho, type SocketEcho } from "../src/socket";

class TestSocket extends EventTarget {
  readyState = 1;
  sent: Array<{ event: string; data: Record<string, unknown> }> = [];
  closed = false;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; this.readyState = 3; }
  message(event: string, data: unknown, channel?: string) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event, data: JSON.stringify(data), channel }) }));
  }
  established(id = "1.2", timeout = 120) { this.message("pusher:connection_established", { socket_id: id, activity_timeout: timeout }); }
  ack(channel: string) { this.message("pusher_internal:subscription_succeeded", {}, channel); }
  serverClose(code: number) { this.dispatchEvent(new CloseEvent("close", { code })); }
}

describe("first-party EchoLike socket client", () => {
  let echo: SocketEcho;
  let sockets: TestSocket[];
  let urls: string[];
  beforeEach(() => {
    vi.useFakeTimers(); sockets = []; urls = [];
    echo = createSocketEcho({ url: "wss://socket.test/app/key", namespace: false, createWebSocket: (url) => {
      urls.push(url); const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
  });
  afterEach(() => { echo.disconnect(); vi.useRealTimers(); });

  it("waits for the handshake and subscription acknowledgement and decodes JSON payloads", () => {
    const handler = vi.fn(); echo.channel("cms.1").listen(".cms.updated", handler);
    expect(sockets[0].sent).toEqual([]);
    expect(new URL(urls[0]).searchParams.get("protocol")).toBe("7");
    sockets[0].established();
    expect(sockets[0].sent).toEqual([{ event: "pusher:subscribe", data: { channel: "cms.1" } }]);
    sockets[0].message("cms.updated", { revision: "too-early" }, "cms.1"); expect(handler).not.toHaveBeenCalled();
    sockets[0].ack("cms.1"); sockets[0].message("cms.updated", { revision: "r1" }, "cms.1");
    expect(handler).toHaveBeenCalledWith({ revision: "r1" });
  });

  it("shares subscriptions until all consumers release them", () => {
    const a = vi.fn(); const b = vi.fn();
    const first = echo.channel("cms.1").listen(".cms.updated", a);
    const second = echo.channel("cms.1").listen(".cms.updated", b);
    sockets[0].established(); sockets[0].ack("cms.1");
    first.stopListening(".cms.updated", a); echo.leave("cms.1");
    expect(sockets[0].sent.filter((m) => m.event === "pusher:unsubscribe")).toHaveLength(0);
    sockets[0].message("cms.updated", { n: 1 }, "cms.1"); expect(b).toHaveBeenCalledOnce(); expect(a).not.toHaveBeenCalled();
    second.stopListening(".cms.updated", b); echo.leave("cms.1"); expect(sockets[0].closed).toBe(true);
  });

  it("authorizes protected channels and discards authorization completed after unsubscribe", async () => {
    let resolve!: (answer: { auth: string }) => void;
    const authorize = vi.fn((_request: unknown, _signal: AbortSignal) => new Promise<{ auth: string }>((done) => { resolve = done; }));
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", authorize, createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    echo.private("room").listen(".x", vi.fn()); sockets[0].established();
    expect(authorize).toHaveBeenCalledWith({ socketId: "1.2", channelName: "private-room" }, expect.any(AbortSignal));
    const signal = authorize.mock.calls[0][1];
    echo.leave("private-room"); expect(signal.aborted).toBe(true);
    resolve({ auth: "key:signed" }); await Promise.resolve(); await Promise.resolve();
    expect(sockets[0].sent.some((m) => m.event === "pusher:subscribe")).toBe(false);
  });

  it("never subscribes to private channels without authorization", async () => {
    echo.private("room").listen(".x", vi.fn()); sockets[0].established(); await Promise.resolve();
    expect(sockets[0].sent).toEqual([]);
  });

  it("reconnects with a fresh socket ID, reauthorizes once and ignores an old socket", async () => {
    const authorize = vi.fn(async ({ socketId }: { socketId: string }) => ({ auth: `key:${socketId}` }));
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", namespace: false, authorize, createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    const handler = vi.fn(); echo.private("room").listen(".changed", handler);
    sockets[0].established(); await vi.advanceTimersByTimeAsync(0); sockets[0].ack("private-room");
    sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000);
    sockets[1].established("3.4"); await vi.advanceTimersByTimeAsync(0);
    expect(sockets[1].sent).toEqual([{ event: "pusher:subscribe", data: { channel: "private-room", auth: "key:3.4" } }]);
    sockets[1].ack("private-room");
    expect(authorize.mock.calls.map(([value]) => value.socketId)).toEqual(["1.2", "3.4"]);
    sockets[0].message("changed", { old: true }, "private-room"); expect(handler).not.toHaveBeenCalled();
    sockets[1].message("changed", { fresh: true }, "private-room"); expect(handler).toHaveBeenCalledWith({ fresh: true });
  });

  it("honours fatal close codes and manual disconnect without restarting timers", async () => {
    echo.channel("room"); sockets[0].established(); sockets[0].serverClose(4001);
    await vi.advanceTimersByTimeAsync(600000); expect(sockets).toHaveLength(1);
    echo.connect(); expect(sockets).toHaveLength(2); echo.disconnect();
    await vi.advanceTimersByTimeAsync(600000); expect(sockets).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("responds to server pings and detects a connection that never answers a client ping", async () => {
    echo.channel("room"); sockets[0].established("1.2", 2);
    sockets[0].message("pusher:ping", {});
    expect(sockets[0].sent.at(-1)?.event).toBe("pusher:pong");
    await vi.advanceTimersByTimeAsync(2000); expect(sockets[0].sent.at(-1)?.event).toBe("pusher:ping");
    await vi.advanceTimersByTimeAsync(30000); expect(sockets[0].closed).toBe(true);
  });

  it("accepts any server traffic as liveness and clears all timers on final leave", async () => {
    echo.channel("room"); sockets[0].established("1.2", 2);
    await vi.advanceTimersByTimeAsync(2000); sockets[0].message("pusher:pong", {});
    await vi.advanceTimersByTimeAsync(1000); expect(sockets[0].closed).toBe(false);
    echo.leave("room"); expect(vi.getTimerCount()).toBe(0);
  });

  it("formats Laravel names and leaves a leading dot as a literal custom event", () => {
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    const standard = vi.fn(); const custom = vi.fn();
    echo.channel("room").listen("OrderShipped", standard).listen(".cms.updated", custom);
    sockets[0].established(); sockets[0].ack("room");
    sockets[0].message("App\\Events\\OrderShipped", {}, "room"); sockets[0].message("cms.updated", {}, "room");
    expect(standard).toHaveBeenCalledOnce(); expect(custom).toHaveBeenCalledOnce();
  });

  it("rejects invalid endpoints and unsupported encrypted channels", () => {
    for (const url of ["https://socket.test/app/key", "wss://user:secret@socket.test/app/key", "wss://socket.test/app/key#secret"]) {
      expect(() => createSocketEcho({ url })).toThrow();
    }
    expect(() => echo.channel("invalid/channel")).toThrow();
    expect(() => echo.channel("private-encrypted-room")).toThrow();
  });

  it("an old authorization result cannot clear a new connection's authorization timeout", async () => {
    let resolveOld!: (value: { auth: string }) => void;
    const onError = vi.fn();
    const authorize = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", authorize, onError, createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    echo.private("room"); sockets[0].established(); sockets[0].serverClose(4100);
    await vi.advanceTimersByTimeAsync(1000); sockets[1].established("3.4");
    resolveOld({ auth: "old:signed" }); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(onError).toHaveBeenCalledWith({ code: "authorization_failed", channel: "private-room" });
    expect(sockets[1].sent).toEqual([]);
  });

  it("backs off repeated immediate-reconnect close codes instead of spinning", async () => {
    echo.channel("room"); sockets[0].established(); sockets[0].serverClose(4200);
    await vi.advanceTimersByTimeAsync(0); expect(sockets).toHaveLength(2);
    sockets[1].established("3.4"); sockets[1].serverClose(4200);
    await vi.advanceTimersByTimeAsync(999); expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1001); expect(sockets).toHaveLength(3);
  });

  it("requires signed presence data and exposes acknowledgement for resynchronization", async () => {
    const subscribed = vi.fn();
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", namespace: false,
      authorize: async () => ({ auth: "key:signed", channel_data: '{"user_id":"human-1"}' }),
      createWebSocket: () => { const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket; } });
    echo.join("room").subscribed(subscribed); sockets[0].established(); await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].sent[0].data).toEqual({ channel: "presence-room", auth: "key:signed", channel_data: '{"user_id":"human-1"}' });
    sockets[0].ack("presence-room"); expect(subscribed).toHaveBeenCalledOnce();
    sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000); sockets[1].established("3.4");
    await vi.advanceTimersByTimeAsync(0); sockets[1].ack("presence-room"); expect(subscribed).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed frames and isolates a failing consumer callback", () => {
    const healthy = vi.fn();
    echo.channel("room").listen(".changed", () => { throw new Error("host callback failure"); }).listen(".changed", healthy);
    sockets[0].established(); sockets[0].ack("room");
    sockets[0].dispatchEvent(new MessageEvent("message", { data: "{" }));
    sockets[0].message("changed", { ok: true }, "room"); expect(healthy).toHaveBeenCalledWith({ ok: true });
  });

  it("reports a subscription that never receives acknowledgement", async () => {
    const onError = vi.fn();
    echo.disconnect(); echo = createSocketEcho({ url: "wss://socket.test/app/key", onError, createWebSocket: () => {
      const socket = new TestSocket(); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    echo.channel("room"); sockets[0].established(); await vi.advanceTimersByTimeAsync(10000);
    expect(onError).toHaveBeenCalledWith({ code: "subscription_timeout", channel: "room" });
    expect(sockets[0].sent.filter((value) => value.event === "pusher:subscribe")).toHaveLength(1);
  });
});
