import { describe, expect, it } from "vitest";
import { FakeControlClient, runCli } from "./index.ts";

describe("solemcp approve", () => {
  it("exits non-zero with piped stdin and does not call the control client", async () => {
    const client = new FakeControlClient();
    const stderr: string[] = [];

    const code = await runCli(["approve", "connector", "github"], {
      controlClient: client,
      stdinIsTTY: false,
      io: {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    });

    expect(code).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(0);
    expect(stderr.join("")).toMatch(/TTY/i);
  });

  it("approve tool also refuses non-TTY without calling control", async () => {
    const client = new FakeControlClient();
    const code = await runCli(["approve", "tool", "github", "create_issue"], {
      controlClient: client,
      stdinIsTTY: false,
      io: { stdout: () => {}, stderr: () => {} },
    });
    expect(code).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(0);
  });

  it("sends approveConnector over the control client when TTY", async () => {
    const client = new FakeControlClient();
    const code = await runCli(["approve", "connector", "github"], {
      controlClient: client,
      stdinIsTTY: true,
      io: { stdout: () => {}, stderr: () => {} },
    });
    expect(code).toBe(0);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.method).toBe("approveConnector");
  });
});
