import { describe, expect, it } from "vitest";
import { DEFAULT_UPSTREAM_TIMING, nextUpstreamFailure } from "./upstream.ts";

describe("upstream failure", () => {
  it("stops after five failures in five minutes and does not schedule a restart", () => {
    let failures: number[] = [];
    let restartAttempt = 0;
    let last: ReturnType<typeof nextUpstreamFailure> | undefined;
    const start = 1_000_000;
    for (let i = 0; i < 5; i++) {
      last = nextUpstreamFailure(
        { failures, restartAttempt, now: start + i * 1000 },
        DEFAULT_UPSTREAM_TIMING,
      );
      failures = last.failures;
      restartAttempt = last.restartAttempt;
    }
    expect(last?.status).toBe("failed");
    expect(last?.delayMs).toBeUndefined();
    expect(DEFAULT_UPSTREAM_TIMING).toMatchObject({
      maxFailures: 5,
      failureWindowMs: 5 * 60 * 1000,
      baseDelayMs: 1000,
      capMs: 30_000,
    });
  });

  it("backs off 1s, 2s, 4s before the cap", () => {
    const first = nextUpstreamFailure(
      { failures: [], restartAttempt: 0, now: 0 },
      DEFAULT_UPSTREAM_TIMING,
    );
    expect(first).toMatchObject({ status: "stopped", delayMs: 1000, restartAttempt: 1 });
    const second = nextUpstreamFailure(
      { failures: first.failures, restartAttempt: first.restartAttempt, now: 1000 },
      DEFAULT_UPSTREAM_TIMING,
    );
    expect(second.delayMs).toBe(2000);
    const third = nextUpstreamFailure(
      { failures: second.failures, restartAttempt: second.restartAttempt, now: 2000 },
      DEFAULT_UPSTREAM_TIMING,
    );
    expect(third.delayMs).toBe(4000);
  });
});
