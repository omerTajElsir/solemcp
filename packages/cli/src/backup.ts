import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";

/** Copy `sourcePath` into `backupDir` as `<utc>-<basename>`. Returns backup path. */
export async function backupFile(sourcePath: string, backupDir: string): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupDir, `${stamp}-${basename(sourcePath)}`);
  if (existsSync(sourcePath)) {
    await copyFile(sourcePath, dest);
  } else {
    await writeFile(dest, "");
  }
  return dest;
}

/** Restore a backup file onto `targetPath` byte for byte. */
export async function rollbackFile(backupPath: string, targetPath: string): Promise<void> {
  const bytes = await readFile(backupPath);
  await writeFile(targetPath, bytes);
}
