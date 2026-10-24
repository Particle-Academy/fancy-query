import type { EchoChannelLike, EchoLike } from "./types";

export type SocketState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";
export type SocketFailure = { code: string; channel?: string; serverCode?: number };
export type SocketAuthorization = { auth: string; channel_data?: string };
export interface SocketEchoOptions {
  /** Operator-owned endpoint, e.g. wss://socket.example/app/PUBLIC_KEY. */
  url: string;
  /** Laravel's default namespace; false for literal event names. Leading dots are always literal. */
  namespace?: string | false;
  /** Host performs its own authenticated, authorized request. Never put an app secret in this client. */
  authorize?: (request: { socketId: string; channelName: string }, signal: AbortSignal) => Promise<SocketAuthorization>;
  createWebSocket?: (url: string) => WebSocket;
  onState?: (state: SocketState) => void;
  onError?: (failure: SocketFailure) => void;
}

type Handler = (payload: unknown) => void;
type Timer = ReturnType<typeof setTimeout>;
const validChannel = (name: string) => /^[A-Za-z0-9_=@,.;-]{1,164}$/.test(name) && !name.startsWith("private-encrypted-");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const decode = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
};

/** A channel is shared by consumers; each channel/private/join call acquires one lease. */
export class SocketChannel implements EchoChannelLike {
  private handlers = new Map<string, Set<Handler>>();
  leases = 0;
  status: "waiting" | "authorizing" | "sent" | "subscribed" | "failed" = "waiting";
  authorizationTimer?: Timer;
  authorizationAbort?: AbortController;
  acknowledgementTimer?: Timer;

  constructor(readonly name: string, private readonly owner: SocketEcho) {}

  listen(event: string, callback: Handler): this {
    const name = this.owner.eventName(event);
    const handlers = this.handlers.get(name) ?? new Set<Handler>();
    handlers.add(callback); this.handlers.set(name, handlers);
    return this;
  }

  stopListening(event: string, callback?: Handler): this {
    const name = this.owner.eventName(event);
    if (callback) {
      const handlers = this.handlers.get(name); handlers?.delete(callback);
      if (handlers?.size === 0) this.handlers.delete(name);
    } else this.handlers.delete(name);
    return this;
  }

  /** Fires on every acknowledgement, including reconnection; refetch authoritative state here. */
  subscribed(callback: Handler): this { return this.listen(".pusher:subscription_succeeded", callback); }

  deliver(event: string, payload: unknown): void {
    for (const callback of [...(this.handlers.get(event) ?? [])]) {
      try { callback(payload); } catch { this.owner.report({ code: "listener_failed", channel: this.name }); }
    }
  }
}

/**
 * Small Pusher protocol v7 transport for FancyDataRoot's EchoLike contract.
 * No dependency, fallback transport, publishing, encryption or app secret.
 * Creating it is SSR-safe; the first subscription connects when WebSocket exists.
 */
export class SocketEcho implements EchoLike {
  private readonly endpoint: string;
  private channels = new Map<string, SocketChannel>();
  private socket?: WebSocket;
  private socketId?: string;
  private wanted = false;
  private manuallyStopped = false;
  private retries = 0;
  private retryTimer?: Timer;
  private activityTimer?: Timer;
  private handshakeTimer?: Timer;
  private healthyTimer?: Timer;
  private activityMs = 120000;
  private currentState: SocketState = "idle";

  constructor(private readonly options: SocketEchoOptions) {
    const url = new URL(options.url);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash || !/\/app\/[^/]+$/.test(url.pathname)) {
      throw new TypeError("A socket endpoint requires ws(s), an /app/key path and no credentials or fragment.");
    }
    url.searchParams.set("protocol", "7"); url.searchParams.set("client", "js-fancy-query"); url.searchParams.set("version", "1");
    this.endpoint = url.href;
  }

  get state(): SocketState { return this.currentState; }
  channel(name: string): SocketChannel { return this.acquire(name); }
  private(name: string): SocketChannel { return this.acquire(`private-${name}`); }
  join(name: string): SocketChannel { return this.acquire(`presence-${name}`); }

  /** Release one consumer; use the full prefixed name to isolate private/presence subscriptions. */
  leave(name: string): void {
    for (const key of [name, `private-${name}`, `presence-${name}`]) {
      const channel = this.channels.get(key);
      if (!channel || --channel.leases > 0) continue;
      clearTimeout(channel.authorizationTimer); clearTimeout(channel.acknowledgementTimer); this.channels.delete(key);
      channel.authorizationAbort?.abort();
      if (channel.status === "sent" || channel.status === "subscribed") this.send("pusher:unsubscribe", { channel: key });
    }
    if (this.channels.size === 0) {
      this.wanted = false; this.closeSocket(); this.setState("idle");
    }
  }

  connect(): void {
    this.manuallyStopped = false; this.wanted = true;
    if (this.socket || this.retryTimer || this.channels.size === 0) return;
    if (!this.options.createWebSocket && typeof globalThis.WebSocket === "undefined") {
      this.report({ code: "websocket_unavailable" }); this.setState("failed"); return;
    }
    this.setState(this.retries ? "reconnecting" : "connecting");
    if (!this.wanted || this.manuallyStopped) return;
    let socket: WebSocket;
    try { socket = this.options.createWebSocket?.(this.endpoint) ?? new WebSocket(this.endpoint); }
    catch { this.report({ code: "connection_failed" }); this.scheduleReconnect(); return; }
    this.socket = socket;
    this.handshakeTimer = setTimeout(() => this.lost(socket, 4100), 10000);
    socket.addEventListener("message", (event) => this.message(socket, event.data));
    socket.addEventListener("close", (event) => this.lost(socket, event.code));
    socket.addEventListener("error", () => { if (this.socket === socket) this.report({ code: "socket_error" }); });
  }

  disconnect(): void {
    this.manuallyStopped = true; this.wanted = false; this.closeSocket(); this.setState("disconnected");
  }

  eventName(event: string): string {
    if (event.startsWith(".") || event.startsWith("\\")) return event.slice(1);
    const namespace = this.options.namespace === undefined ? "App.Events" : this.options.namespace;
    return namespace ? `${namespace}.${event}`.split(".").join("\\") : event;
  }

  report(failure: SocketFailure): void {
    try { this.options.onError?.(failure); } catch { /* A host callback cannot break transport cleanup. */ }
  }

  private acquire(name: string): SocketChannel {
    if (!validChannel(name)) throw new TypeError("Invalid or unsupported socket channel.");
    let channel = this.channels.get(name);
    if (!channel) {
      if (this.channels.size >= 100) throw new RangeError("A socket client supports at most 100 channels.");
      channel = new SocketChannel(name, this); this.channels.set(name, channel);
    }
    channel.leases++;
    if (!this.manuallyStopped) this.connect();
    if (this.socketId) void this.subscribe(channel);
    return channel;
  }

  private async subscribe(channel: SocketChannel): Promise<void> {
    const socket = this.socket; const socketId = this.socketId;
    if (!socket || !socketId || channel.status !== "waiting") return;
    const data: Record<string, unknown> = { channel: channel.name };
    if (channel.name.startsWith("private-") || channel.name.startsWith("presence-")) {
      if (!this.options.authorize) { channel.status = "failed"; this.report({ code: "authorization_required", channel: channel.name }); return; }
      channel.status = "authorizing";
      let authorizationTimer: Timer | undefined;
      const controller = new AbortController(); channel.authorizationAbort = controller;
      try {
        const authorization = this.options.authorize({ socketId, channelName: channel.name }, controller.signal);
        const cancelled = new Promise<never>((_, reject) => {
          const cancel = () => reject(new Error("authorization_cancelled"));
          if (controller.signal.aborted) cancel();
          else controller.signal.addEventListener("abort", cancel, { once: true });
        });
        const timeout = new Promise<never>((_, reject) => {
          authorizationTimer = setTimeout(() => { controller.abort(); reject(new Error("authorization_timeout")); }, 10000);
          channel.authorizationTimer = authorizationTimer;
        });
        const answer = await Promise.race([authorization, timeout, cancelled]);
        if (this.socket !== socket || this.socketId !== socketId || this.channels.get(channel.name) !== channel || channel.status !== "authorizing") return;
        if (!record(answer) || typeof answer.auth !== "string" || !answer.auth || answer.auth.length > 2048) throw new Error("invalid_authorization");
        data.auth = answer.auth;
        if (channel.name.startsWith("presence-")) {
          if (typeof answer.channel_data !== "string" || answer.channel_data.length > 10000 || !record(decode(answer.channel_data))) throw new Error("invalid_presence");
          data.channel_data = answer.channel_data;
        }
      } catch {
        if (this.socket === socket && this.channels.get(channel.name) === channel) {
          channel.status = "failed"; this.report({ code: "authorization_failed", channel: channel.name });
        }
        return;
      } finally {
        clearTimeout(authorizationTimer);
        controller.abort();
        if (channel.authorizationTimer === authorizationTimer) channel.authorizationTimer = undefined;
        if (channel.authorizationAbort === controller) channel.authorizationAbort = undefined;
      }
    }
    if (this.socket === socket && this.channels.get(channel.name) === channel && this.send("pusher:subscribe", data)) {
      channel.status = "sent";
      channel.acknowledgementTimer = setTimeout(() => {
        if (this.socket === socket && this.channels.get(channel.name) === channel && channel.status === "sent") {
          channel.status = "failed"; this.send("pusher:unsubscribe", { channel: channel.name });
          this.report({ code: "subscription_timeout", channel: channel.name });
        }
      }, 10000);
    }
  }

  private message(socket: WebSocket, raw: unknown): void {
    if (this.socket !== socket) return;
    if (typeof raw !== "string" || raw.length > 1048576) { this.report({ code: "invalid_message" }); return; }
    let message: unknown;
    try { message = JSON.parse(raw); } catch { this.report({ code: "invalid_message" }); return; }
    if (!record(message) || typeof message.event !== "string") { this.report({ code: "invalid_message" }); return; }
    const data = decode(message.data);
    if (this.socketId) this.resetActivity();
    if (message.event === "pusher:connection_established") {
      if (this.socketId) return;
      if (!record(data) || typeof data.socket_id !== "string" || !/^\d+\.\d+$/.test(data.socket_id)
        || typeof data.activity_timeout !== "number" || !Number.isFinite(data.activity_timeout) || data.activity_timeout < 1) {
        this.report({ code: "invalid_handshake" }); this.lost(socket, 4001); return;
      }
      clearTimeout(this.handshakeTimer); this.socketId = data.socket_id;
      this.healthyTimer = setTimeout(() => { if (this.socket === socket) this.retries = 0; }, 10000);
      this.activityMs = Math.min(120, data.activity_timeout) * 1000; this.resetActivity(); this.setState("connected");
      for (const channel of this.channels.values()) void this.subscribe(channel);
      return;
    }
    if (message.event === "pusher:ping") { this.send("pusher:pong", {}); return; }
    if (message.event === "pusher:pong") return;
    if (message.event === "pusher:error") {
      this.report({ code: "server_error", ...(record(data) && typeof data.code === "number" ? { serverCode: data.code } : {}) }); return;
    }
    const channel = typeof message.channel === "string" ? this.channels.get(message.channel) : undefined;
    if (message.event === "pusher_internal:subscription_succeeded" && channel?.status === "sent") {
      clearTimeout(channel.acknowledgementTimer);
      channel.status = "subscribed"; channel.deliver("pusher:subscription_succeeded", data); return;
    }
    if (channel?.status === "subscribed") channel.deliver(message.event, data);
  }

  private send(event: string, data: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.socketId) return false;
    try { socket.send(JSON.stringify({ event, data })); return true; }
    catch { this.report({ code: "send_failed" }); this.lost(socket, 4100); return false; }
  }

  private resetActivity(): void {
    clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      const socket = this.socket;
      if (!socket || !this.send("pusher:ping", {})) return;
      this.activityTimer = setTimeout(() => this.lost(socket, 4100), 30000);
    }, this.activityMs);
  }

  private closeSocket(): void {
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    clearTimeout(this.activityTimer); clearTimeout(this.handshakeTimer); clearTimeout(this.healthyTimer);
    const socket = this.socket; this.socket = undefined; this.socketId = undefined;
    for (const channel of this.channels.values()) {
      clearTimeout(channel.authorizationTimer); clearTimeout(channel.acknowledgementTimer); channel.status = "waiting";
      channel.authorizationAbort?.abort();
    }
    try { socket?.close(); } catch { /* Already closed. */ }
  }

  private lost(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.closeSocket();
    if (code >= 4000 && code < 4100) { this.wanted = false; this.manuallyStopped = true; this.setState("failed"); return; }
    if (this.wanted && this.channels.size > 0) this.scheduleReconnect(code >= 4200 && code < 4300);
    else this.setState("disconnected");
  }

  private scheduleReconnect(immediate = false): void {
    if (!this.wanted || this.manuallyStopped || this.retryTimer || this.channels.size === 0) return;
    const attempt = this.retries++;
    const delay = immediate && attempt === 0 ? 0 : [1000, 2000, 5000, 10000, 30000][Math.min(attempt, 4)];
    this.setState("reconnecting");
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.connect(); }, delay);
  }

  private setState(state: SocketState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    try { this.options.onState?.(state); } catch { this.report({ code: "state_listener_failed" }); }
  }
}

export function createSocketEcho(options: SocketEchoOptions): SocketEcho { return new SocketEcho(options); }
