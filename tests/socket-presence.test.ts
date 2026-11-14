import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSocketEcho, type SocketEcho } from "../src/socket";
import type { EchoChannelLike } from "../src/types";

class TestSocket extends EventTarget {
  readyState = 1;
  sent: Array<{ event: string; data: unknown; channel?: string }> = [];
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
  message(event: string, data: unknown, channel?: string, extra: Record<string, unknown> = {}) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event, data: JSON.stringify(data), channel, ...extra }) }));
  }
  established(id = "1.2") { this.message("pusher:connection_established", { socket_id: id, activity_timeout: 120 }); }
  ackPresence(channel: string, members: Record<string, unknown>) {
    this.message("pusher_internal:subscription_succeeded", {
      presence: { ids: Object.keys(members), hash: members, count: Object.keys(members).length },
    }, channel);
  }
  serverClose(code: number) { this.dispatchEvent(new CloseEvent("close", { code })); }
}

const presenceAuth = async ({ socketId }: { socketId: string }) => ({
  auth: `key:${socketId}`,
  channel_data: JSON.stringify({ user_id: "a", user_info: { ref: "a" } }),
});

describe("presence members and whispers on the first-party socket", () => {
  let echo: SocketEcho;
  let sockets: TestSocket[];
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers(); sockets = []; onError = vi.fn();
    echo = createSocketEcho({
      url: "wss://socket.test/app/key", namespace: false, authorize: presenceAuth, onError,
      createWebSocket: () => { const s = new TestSocket(); sockets.push(s); return s as unknown as WebSocket; },
    });
  });
  afterEach(() => { echo.disconnect(); vi.useRealTimers(); });

  async function joined(name = "cowork.session.1") {
    const channel = echo.join(name);
    sockets[0].established(); await vi.advanceTimersByTimeAsync(0);
    return channel;
  }

  it("calls here with every member's info on the acknowledgement", async () => {
    const here = vi.fn();
    const channel = await joined(); channel.here(here);
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" }, b: { ref: "b", label: "Bea" } });
    expect(here).toHaveBeenCalledOnce();
    expect(here).toHaveBeenCalledWith([{ ref: "a" }, { ref: "b", label: "Bea" }]);
  });

  it("calls joining and leaving from member_added and member_removed, leaving with the remembered info", async () => {
    const joining = vi.fn(); const leaving = vi.fn();
    const channel = await joined(); channel.joining(joining).leaving(leaving);
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" } });
    sockets[0].message("pusher_internal:member_added", { user_id: "c", user_info: { ref: "c" } }, "presence-cowork.session.1");
    expect(joining).toHaveBeenCalledWith({ ref: "c" });
    sockets[0].message("pusher_internal:member_removed", { user_id: "c" }, "presence-cowork.session.1");
    expect(leaving).toHaveBeenCalledWith({ ref: "c" });
    expect(channel.members()).toEqual([{ ref: "a" }]);
  });

  it("re-fires here after a reconnect, with the fresh member list", async () => {
    const here = vi.fn();
    const channel = await joined(); channel.here(here);
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" }, b: { ref: "b" } });
    sockets[0].serverClose(4100); await vi.advanceTimersByTimeAsync(1000);
    sockets[1].established("3.4"); await vi.advanceTimersByTimeAsync(0);
    sockets[1].ackPresence("presence-cowork.session.1", { a: { ref: "a" } });
    expect(here).toHaveBeenCalledTimes(2);
    expect(here).toHaveBeenLastCalledWith([{ ref: "a" }]);
  });

  it("whispers a client- event on a presence channel once subscribed", async () => {
    const channel = await joined();
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" } });
    channel.whisper("cursor", { x: 1 });
    expect(sockets[0].sent.at(-1)).toEqual({ event: "client-cursor", channel: "presence-cowork.session.1", data: { x: 1 } });
  });

  it("whispers on a private channel too", async () => {
    const channel = echo.private("cowork.participant.a");
    sockets[0].established(); await vi.advanceTimersByTimeAsync(0);
    sockets[0].message("pusher_internal:subscription_succeeded", {}, "private-cowork.participant.a");
    channel.whisper("ping", {});
    expect(sockets[0].sent.at(-1)).toEqual({ event: "client-ping", channel: "private-cowork.participant.a", data: {} });
  });

  it("never sends a client event on a public channel, and says so", async () => {
    const channel = echo.channel("news");
    sockets[0].established(); await vi.advanceTimersByTimeAsync(0);
    sockets[0].message("pusher_internal:subscription_succeeded", {}, "news");
    const before = sockets[0].sent.length;
    channel.whisper("cursor", { x: 1 });
    expect(sockets[0].sent.length).toBe(before);
    expect(onError).toHaveBeenCalledWith({ code: "whisper_unsupported", channel: "news" });
  });

  it("drops a whisper sent before the subscription is acknowledged, and says so", async () => {
    const channel = await joined();
    const before = sockets[0].sent.length;
    channel.whisper("cursor", { x: 1 });
    expect(sockets[0].sent.length).toBe(before);
    expect(onError).toHaveBeenCalledWith({ code: "whisper_not_subscribed", channel: "presence-cowork.session.1" });
  });

  it("refuses a whisper over the protocol's 10 KB client-event limit", async () => {
    const channel = await joined();
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" } });
    const before = sockets[0].sent.length;
    channel.whisper("big", { text: "x".repeat(10241) });
    expect(sockets[0].sent.length).toBe(before);
    expect(onError).toHaveBeenCalledWith({ code: "whisper_too_large", channel: "presence-cowork.session.1" });
  });

  it("delivers a peer's whisper to listenForWhisper with the server-stamped sender", async () => {
    const heard = vi.fn();
    const channel = await joined(); channel.listenForWhisper("cursor", heard);
    sockets[0].ackPresence("presence-cowork.session.1", { a: { ref: "a" } });
    sockets[0].message("client-cursor", { x: 2 }, "presence-cowork.session.1", { user_id: "b" });
    expect(heard).toHaveBeenCalledWith({ x: 2 }, { userId: "b" });
    channel.stopListeningForWhisper("cursor", heard);
    sockets[0].message("client-cursor", { x: 3 }, "presence-cowork.session.1", { user_id: "b" });
    expect(heard).toHaveBeenCalledOnce();
  });

  it("keeps the members optional on the shared channel contract", () => {
    // A laravel-echo channel without presence members must still type-check as EchoChannelLike.
    const minimal: EchoChannelLike = { listen() { return minimal; } };
    expect(minimal.here).toBeUndefined();
    expect(minimal.whisper).toBeUndefined();
  });
});
