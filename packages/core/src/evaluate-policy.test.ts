import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./evaluate-policy.ts";

const APPROVED = ["create_issue", "list_issues", "delete_issue"];

describe("evaluatePolicy", () => {
  it("returns all approved names for all-approved", () => {
    expect(evaluatePolicy(APPROVED, { mode: "all-approved" })).toEqual({
      names: APPROVED,
      unknownNames: [],
    });
  });

  it("returns the intersection for allow", () => {
    expect(
      evaluatePolicy(APPROVED, { allow: ["list_issues", "missing", "create_issue"] }),
    ).toEqual({
      names: ["list_issues", "create_issue"],
      unknownNames: ["missing"],
    });
  });

  it("returns approved minus deny names", () => {
    expect(
      evaluatePolicy(APPROVED, { deny: ["delete_issue", "not_a_tool"] }),
    ).toEqual({
      names: ["create_issue", "list_issues"],
      unknownNames: ["not_a_tool"],
    });
  });

  it("does not drop the connector when allow names are unknown", () => {
    const result = evaluatePolicy(APPROVED, { allow: ["ghost"] });
    expect(result.names).toEqual([]);
    expect(result.unknownNames).toEqual(["ghost"]);
  });
});
