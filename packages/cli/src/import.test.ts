import { describe, expect, it } from "vitest";
import { FakeControlClient, previewImport, runCli } from "./index.ts";

describe("client import", () => {
  it("preview writes nothing and lists candidate connectors", () => {
    const preview = previewImport([
      {
        client: "cursor",
        path: "/tmp/mcp.json",
        text: JSON.stringify({
          mcpServers: {
            solemcp: { command: "solemcp", args: ["bridge"] },
            github: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
            },
          },
        }),
      },
    ]);

    expect(preview.wouldWrite).toBe(false);
    expect(preview.connectors).toHaveLength(1);
    expect(preview.connectors[0]?.slug).toBe("github");
    expect(preview.connectors[0]?.transport).toBe("stdio");
  });

  it("cli import without --confirm does not call importApply", async () => {
    const client = new FakeControlClient();
    const stdout: string[] = [];
    const code = await runCli(["client", "import"], {
      controlClient: client,
      io: {
        stdout: (l) => stdout.push(l),
        stderr: () => {},
      },
    });
    expect(code).toBe(0);
    expect(client.calls.some((c) => c.method === "importApply")).toBe(false);
    expect(stdout.join("")).toMatch(/preview only/i);
  });

  it("cli import --confirm calls importApply on the control client", async () => {
    const client = new FakeControlClient();
    const code = await runCli(["client", "import", "--confirm"], {
      controlClient: client,
      io: { stdout: () => {}, stderr: () => {} },
    });
    expect(code).toBe(0);
    expect(client.calls.some((c) => c.method === "importApply")).toBe(true);
  });
});
