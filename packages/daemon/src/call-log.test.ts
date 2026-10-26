import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CallLog } from "./call-log.ts";

describe("call log", () => {
  it("stores outcome without arguments and redacts secrets in results and errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "solemcp-calls-"));
    const file = join(dir, "calls.json");
    const log = new CallLog(file);
    const secret = "super-secret-value-do-not-leak";

    await log.record({
      projectId: "project-1",
      tool: "github__create_issue",
      ok: true,
      durationMs: 12,
      resultText: JSON.stringify({ content: [{ text: secret }], arguments: { token: secret } }),
      secretValues: [secret],
    });
    await log.record({
      projectId: "project-1",
      tool: "github__create_issue",
      ok: false,
      durationMs: 4,
      errorText: `upstream failed: ${secret}`,
      resultText: secret,
      secretValues: [secret],
    });
    await log.record({
      projectId: null,
      tool: "fixture__echo",
      ok: false,
      durationMs: 3,
      errorText: "saw ghp_abcdefghijklmnopqrstuvwxyz",
      secretValues: [],
    });

    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(raw).not.toContain("arguments");
    const parsed = JSON.parse(raw) as { entries: Array<Record<string, unknown>> };
    expect(parsed.entries[0]?.error).toBe("saw [redacted]");
    expect(parsed.entries[1]?.error).toBe("upstream failed: [redacted]");
    expect(parsed.entries[2]).not.toHaveProperty("error");
    for (const entry of parsed.entries) {
      expect(entry).not.toHaveProperty("arguments");
      expect(entry).not.toHaveProperty("result");
      expect(entry).not.toHaveProperty("resultText");
    }
  });
});
