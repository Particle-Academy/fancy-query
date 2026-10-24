import { render, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FancyDataRoot } from "../src/FancyDataRoot";
import { useFancyEchoInvalidation } from "../src/useFancyEchoInvalidation";
import { useFancyStream } from "../src/useFancyStream";
import { createSocketEcho } from "../src/socket";

class TestSocket extends EventTarget {
  readyState = 1;
  closed = false;
  send() {}
  close() { this.closed = true; }
  message(event: string, data: unknown, channel?: string) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event, data: JSON.stringify(data), channel }) }));
  }
}

describe("socket hook cleanup", () => {
  for (const kind of ["invalidation", "stream"] as const) {
    it(`${kind} cleanup preserves a public subscription with the same bare name`, async () => {
      const socket = new TestSocket();
      const echo = createSocketEcho({ url: "wss://socket.test/app/key", namespace: false,
        createWebSocket: () => socket as unknown as WebSocket, authorize: async () => ({ auth: "key:signed" }) });
      function Invalidation({ channel }: { channel: string }) {
        useFancyEchoInvalidation(channel, { ".cms.updated": [["cms"]] }); return null;
      }
      function Stream({ channel }: { channel: string }) {
        useFancyStream(["cms", channel], { channel, fetchInitial: async () => [], on: { ".cms.updated": (cache) => cache } }); return null;
      }
      const Probe = kind === "invalidation" ? Invalidation : Stream;
      function Host({ privateActive }: { privateActive: boolean }) {
        return <FancyDataRoot echo={echo}><Probe channel="room" />{privateActive && <Probe channel="private-room" />}</FancyDataRoot>;
      }
      const view = render(<Host privateActive />);
      try {
        await act(async () => { socket.message("pusher:connection_established", { socket_id: "1.2", activity_timeout: 120 }); });
        await act(async () => {
          socket.message("pusher_internal:subscription_succeeded", {}, "room");
          socket.message("pusher_internal:subscription_succeeded", {}, "private-room");
        });
        view.rerender(<Host privateActive={false} />);
        expect(socket.closed).toBe(false);
      } finally { view.unmount(); echo.disconnect(); }
    });
  }
});
