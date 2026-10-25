import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupFile, rollbackFile } from "./index.ts";

describe("backup and rollback", () => {
  it("backup file exists before write and rollback restores byte for byte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "solemcp-bak-"));
    const target = join(dir, "mcp.json");
    const backupDir = join(dir, "backups");
    const original = Buffer.from('{"mcpServers":{"a":{"command":"a"}}}\n', "utf8");
    await writeFile(target, original);

    const backupPath = await backupFile(target, backupDir);
    const backupBytes = await readFile(backupPath);
    expect(backupBytes.equals(original)).toBe(true);

    await writeFile(target, Buffer.from('{"mcpServers":{}}\n', "utf8"));
    expect(await readFile(target, "utf8")).not.toBe(original.toString("utf8"));

    await rollbackFile(backupPath, target);
    const restored = await readFile(target);
    expect(restored.equals(original)).toBe(true);
  });
});
