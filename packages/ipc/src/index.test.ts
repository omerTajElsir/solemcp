import { describe, expect, it } from "vitest";
import {
  createFrameDecoder,
  encodeFrame,
  parseControlRequest,
  parseHello,
  RESERVED_SLUG,
  socketPath,
  STATUS_TOOL,
} from "./index.ts";

describe("ipc contract", () => {
  it("requires a root on bridge hello", () => {
    expect(() => parseHello({ type: "hello", token: "t", role: "bridge" })).toThrow(/root/);
    expect(parseHello({ type: "hello", token: "t", role: "bridge", root: "/repo" }).root).toBe("/repo");
  });

  it("rejects unknown control methods", () => {
    expect(() => parseControlRequest({ id: "1", method: "approve" })).toThrow(/unknown/);
    expect(parseControlRequest({ id: "1", method: "approveConnector", slug: "github" }).method).toBe(
      "approveConnector",
    );
  });

  it("round-trips a length-prefixed frame", () => {
    const frames: unknown[] = [];
    const push = createFrameDecoder((value) => frames.push(value));
    const encoded = encodeFrame({ type: "hello", token: "abc", role: "cli" });
    push(encoded.subarray(0, 3));
    expect(frames).toHaveLength(0);
    push(encoded.subarray(3));
    expect(frames).toEqual([{ type: "hello", token: "abc", role: "cli" }]);
  });

  it("places the socket under the user config directory", () => {
    expect(socketPath("/Users/me")).toBe("/Users/me/.solemcp/run/daemon.sock");
    expect(RESERVED_SLUG).toBe("solemcp");
    expect(STATUS_TOOL).toBe("solemcp__status");
  });
});
