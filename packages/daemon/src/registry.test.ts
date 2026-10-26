import { describe, expect, it } from "vitest";
import {
  planRegistryServer,
  RegistryError,
  searchOfficialRegistry,
} from "./registry.ts";

const npmServer = {
  server: {
    name: "io.github.example/filesystem",
    title: "Filesystem",
    description: "Read files",
    version: "1.2.3",
    packages: [
      {
        registryType: "npm",
        identifier: "@example/filesystem",
        runtimeHint: "npx",
        runtimeArguments: [{ type: "positional", value: "-y" }],
        environmentVariables: [
          { name: "ROOT", description: "Root path", isRequired: true },
          { name: "API_TOKEN", description: "Token", isSecret: true },
        ],
      },
    ],
  },
};

describe("official MCP registry", () => {
  it("plans an npm package and asks for required values before install", () => {
    const needs = planRegistryServer(npmServer, {});
    expect(needs.status).toBe("needs_env");
    if (needs.status !== "needs_env") return;
    expect(needs.catalogId).toBe("io.github.example/filesystem");
    expect(needs.variables.map((v) => v.name)).toEqual(["ROOT", "API_TOKEN"]);

    const ready = planRegistryServer(npmServer, { ROOT: "/tmp", API_TOKEN: "sekret" });
    expect(ready).toMatchObject({
      status: "ready",
      transport: "stdio",
      argv: ["npx", "-y", "@example/filesystem"],
      slugBase: "filesystem",
      secretRefs: ["ROOT", "API_TOKEN"],
    });
  });

  it("uses a remote URL when the server has no package", () => {
    const ready = planRegistryServer({
      server: {
        name: "com.example/remote",
        description: "Hosted",
        version: "0.1.0",
        remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
      },
    });
    expect(ready).toMatchObject({
      status: "ready",
      transport: "http",
      url: "https://example.com/mcp",
      sseFallback: false,
    });
  });

  it("reports a clear error when the registry cannot be reached", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await expect(searchOfficialRegistry("files", fetchImpl)).rejects.toBeInstanceOf(RegistryError);
    await expect(searchOfficialRegistry("files", fetchImpl)).rejects.toThrow(/Ready-made tools/);
  });

  it("reads server names from a registry list payload", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          servers: [npmServer],
        }),
      )) as typeof fetch;
    const result = await searchOfficialRegistry("file", fetchImpl);
    expect(result.servers[0]).toMatchObject({
      name: "io.github.example/filesystem",
      title: "Filesystem",
    });
  });
});
