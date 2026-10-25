import { describe, expect, it } from "vitest";
import { modeIs } from "./mode.ts";

describe("modeIs", () => {
  it("compares permission bits from a numeric fixture", () => {
    // Simulated st_mode from a directory: type bits + 0700
    const dirStatMode = 0o40700;
    expect(modeIs(dirStatMode, 0o700)).toBe(true);
    expect(modeIs(dirStatMode, 0o600)).toBe(false);

    const fileStatMode = 0o100600;
    expect(modeIs(fileStatMode, 0o600)).toBe(true);
    expect(modeIs(fileStatMode, 0o700)).toBe(false);
  });
});
