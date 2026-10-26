import { describe, expect, it } from "vitest";
import { searchTools } from "./search-tools.ts";

const tools = [
  { name: "github__create_issue", description: "Open a GitHub issue" },
  { name: "github__list_issues", description: "List issues" },
];

describe("searchTools", () => {
  it("returns names and descriptions that match the query", () => {
    expect(searchTools(tools, "create")).toEqual([
      { name: "github__create_issue", description: "Open a GitHub issue" },
    ]);
  });

  it("returns the full list for an empty query", () => {
    expect(searchTools(tools, "  ")).toEqual(tools);
  });
});
