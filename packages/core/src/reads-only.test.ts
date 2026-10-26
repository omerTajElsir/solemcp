import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./evaluate-policy.ts";
import { countsAsWrite, filterReadsOnly } from "./reads-only.ts";

const read = { name: "list", annotations: { readOnlyHint: true } };
const destructive = { name: "delete", annotations: { destructiveHint: true } };
const both = {
  name: "wipe",
  annotations: { readOnlyHint: true, destructiveHint: true },
};
const plain = { name: "echo" };

describe("reads-only", () => {
  it("treats unannotated and destructive tools as writes", () => {
    expect(countsAsWrite(undefined)).toBe(true);
    expect(countsAsWrite({})).toBe(true);
    expect(countsAsWrite({ readOnlyHint: true })).toBe(false);
    expect(countsAsWrite({ destructiveHint: true })).toBe(true);
    expect(countsAsWrite({ readOnlyHint: true, destructiveHint: true })).toBe(true);
  });

  it("keeps the full list when the project is not reads-only", () => {
    const tools = [read, destructive, plain];
    expect(filterReadsOnly(tools, { mode: "all-approved" }, false)).toEqual(tools);
  });

  it("hides writes until an allow policy names them", () => {
    const tools = [read, destructive, both, plain];
    const visible = (
      policy: Parameters<typeof evaluatePolicy>[1],
    ) => {
      const names = new Set(evaluatePolicy(tools.map((tool) => tool.name), policy).names);
      return filterReadsOnly(
        tools.filter((tool) => names.has(tool.name)),
        policy,
        true,
      ).map((tool) => tool.name);
    };
    expect(visible({ mode: "all-approved" })).toEqual(["list"]);
    expect(visible({ allow: ["echo", "delete"] })).toEqual(["delete", "echo"]);
    expect(visible({ deny: ["list"] })).toEqual([]);
  });
});
