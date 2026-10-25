import { NAMESPACE_SEPARATOR } from "@solemcp/ipc";
import { describe, expect, it } from "vitest";
import { namespaceTool } from "./namespace.ts";

describe("namespaceTool", () => {
  it("joins slug and tool with the ipc separator", () => {
    expect(namespaceTool("github", "create_issue")).toBe(
      `github${NAMESPACE_SEPARATOR}create_issue`,
    );
    expect(namespaceTool("github", "create_issue")).toBe("github__create_issue");
  });

  it("rejects the reserved solemcp slug", () => {
    expect(() => namespaceTool("solemcp", "status")).toThrow(/reserved/);
  });
});
