import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, commandHash, inputSchemaHash } from "./hash.ts";

describe("canonicalJson", () => {
  it("sorts object keys and omits whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });
});

describe("commandHash", () => {
  it("hashes stdio with default cwd daemon", () => {
    const expected = `sha256:${createHash("sha256")
      .update(
        canonicalJson({
          argv: ["npx", "server"],
          cwd: "daemon",
          transport: "stdio",
        }),
        "utf8",
      )
      .digest("hex")}`;
    expect(commandHash({ transport: "stdio", argv: ["npx", "server"] })).toBe(
      expected,
    );
  });

  it("includes explicit cwd in the stdio hash", () => {
    const withProject = commandHash({
      transport: "stdio",
      argv: ["npx"],
      cwd: "project",
    });
    const withDaemon = commandHash({
      transport: "stdio",
      argv: ["npx"],
      cwd: "daemon",
    });
    expect(withProject).not.toBe(withDaemon);
    expect(withProject.startsWith("sha256:")).toBe(true);
  });

  it("hashes http by transport and url", () => {
    const expected = `sha256:${createHash("sha256")
      .update(canonicalJson({ transport: "http", url: "https://example.com/mcp" }), "utf8")
      .digest("hex")}`;
    expect(
      commandHash({ transport: "http", url: "https://example.com/mcp" }),
    ).toBe(expected);
  });
});

describe("inputSchemaHash", () => {
  it("hashes canonical JSON of the schema object", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const expected = `sha256:${createHash("sha256")
      .update(canonicalJson(schema), "utf8")
      .digest("hex")}`;
    expect(inputSchemaHash(schema)).toBe(expected);
  });
});
