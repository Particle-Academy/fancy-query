import { render, act } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FancyDataRoot } from "../src/FancyDataRoot";
import { useFancyStream } from "../src/useFancyStream";

/**
 * Missed-broadcast recovery (fancy-query#4).
 *
 * `while: "streaming"` can only start polling once `stream.started` has been
 * RECEIVED — so the mechanism meant to survive a dropped broadcast is itself
 * gated on receiving one. `while: () => boolean` exists to break that
 * dependency, and these pin the behaviour that makes it actually work.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <FancyDataRoot echo={null}>{children}</FancyDataRoot>
);

/** Mounts the hook with no Echo client at all — nothing can ever broadcast. */
function mountWithPoll(pollWhile: "streaming" | "always" | (() => boolean), fetchInitial: () => Promise<unknown>) {
  function Probe() {
    useFancyStream(["chat", "1"], {
      channel: "private-chat.1",
      fetchInitial,
      echo: null,
      poll: { while: pollWhile, intervalMs: 1000 },
    });
    return null;
  }
  return render(<Probe />, { wrapper });
}

describe("useFancyStream — poll.while", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('"streaming" never polls when the start event is dropped — the reported bug', async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    mountWithPoll("streaming", fetchInitial);
    const afterSeed = fetchInitial.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // No start event was ever received, so recovery never engages. This is the
    // defect the predicate exists to route around, pinned so the workaround
    // cannot be quietly removed.
    expect(fetchInitial.mock.calls.length).toBe(afterSeed);
  });

  it("a predicate polls with no broadcast at all", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    mountWithPoll(() => true, fetchInitial);
    const afterSeed = fetchInitial.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    expect(fetchInitial.mock.calls.length).toBeGreaterThan(afterSeed);
  });

  it("re-reads the predicate every tick, so a ref that flips mid-turn is honoured", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);
    const processing = { current: false };

    mountWithPoll(() => processing.current, fetchInitial);
    const afterSeed = fetchInitial.mock.calls.length;

    // Idle: the interval is alive but every tick declines.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(fetchInitial.mock.calls.length).toBe(afterSeed);

    // A ref flip triggers NO re-render — if the predicate were evaluated once in
    // the effect instead of per tick, the poll would stay stuck off forever.
    processing.current = true;
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(fetchInitial.mock.calls.length).toBeGreaterThan(afterSeed);
  });

  it("survives re-renders with an inline predicate (new identity each render)", async () => {
    const fetchInitial = vi.fn().mockResolvedValue([]);

    function Probe({ tick }: { tick: number }) {
      const processing = useRef(true);
      useFancyStream(["chat", String(tick)], {
        channel: "private-chat.1",
        fetchInitial,
        echo: null,
        // A fresh arrow every render. If this landed in the effect's deps the
        // interval would be torn down and recreated on each render and could
        // never reach its first tick.
        poll: { while: () => processing.current, intervalMs: 1000 },
      });
      return null;
    }

    const view = render(<Probe tick={0} />, { wrapper });
    const afterSeed = fetchInitial.mock.calls.length;

    // Re-render repeatedly at a cadence faster than the interval.
    for (let i = 1; i <= 4; i++) {
      view.rerender(<Probe tick={0} />);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
    }

    expect(fetchInitial.mock.calls.length).toBeGreaterThan(afterSeed);
  });
});
