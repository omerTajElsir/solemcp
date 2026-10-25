import { describe, expect, it } from "vitest";
import { runUiCommand } from "./ui.ts";

describe("solemcp ui", () => {
  it("refuses non-TTY stdin", async () => {
    const code = await runUiCommand({
      stdinIsTTY: false,
      ensureDaemon: async () => {
        throw new Error("should not start daemon");
      },
    });
    expect(code).toBe(1);
  });
});
