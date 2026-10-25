import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  BACKUP_DIR,
  CONFIG_FILE,
  LOCK_FILE,
  solemcpHome,
} from "@solemcp/ipc";
import { parseConfig, type Config } from "@solemcp/schema";
import { emptyConfig } from "./empty-config.ts";

const MAX_BACKUPS = 50;
const HOME_MODE = 0o700;
const CONFIG_MODE = 0o600;

export type ConfigStoreOptions = {
  /** User home directory; tests inject a tmpdir. Never the real ~/.solemcp unless intended. */
  home: string;
};

/**
 * Config under `{home}/.solemcp/`. Modes 0700 / 0600.
 * Exclusive lock via config.lock (O_EXCL hold file). Atomic write: temp + rename.
 * Backups under backups/ before writes, keep last 50.
 */
export class ConfigStore {
  readonly root: string;
  private readonly configPath: string;
  private readonly lockPath: string;
  private readonly backupDir: string;

  constructor(opts: ConfigStoreOptions) {
    this.root = solemcpHome(opts.home);
    this.configPath = join(this.root, CONFIG_FILE);
    this.lockPath = join(this.root, LOCK_FILE);
    this.backupDir = join(this.root, BACKUP_DIR);
  }

  async ensureLayout(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: HOME_MODE });
    await chmod(this.root, HOME_MODE);
    await mkdir(this.backupDir, { recursive: true, mode: HOME_MODE });
  }

  async read(): Promise<Config> {
    await this.ensureLayout();
    try {
      const raw = await readFile(this.configPath, "utf8");
      return parseConfig(JSON.parse(raw) as unknown);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const cfg = emptyConfig();
        await this.write(cfg);
        return cfg;
      }
      throw err;
    }
  }

  /**
   * Backup current file (if any), then atomically write config.
   * Holds an exclusive lock for the whole operation.
   */
  async write(config: Config): Promise<void> {
    await this.ensureLayout();
    await this.withLock(async () => {
      await this.backupCurrent();
      await this.atomicWrite(config);
    });
  }

  /** Update under lock: read → mutate → write (with backup). */
  async update(mutator: (config: Config) => Config | Promise<Config>): Promise<Config> {
    await this.ensureLayout();
    return this.withLock(async () => {
      let current: Config;
      try {
        const raw = await readFile(this.configPath, "utf8");
        current = parseConfig(JSON.parse(raw) as unknown);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          current = emptyConfig();
        } else {
          throw err;
        }
      }
      const next = await mutator(current);
      await this.backupCurrent();
      await this.atomicWrite(next);
      return next;
    });
  }

  /** Create a backup of the current config without writing a new one. */
  async backup(): Promise<string | null> {
    await this.ensureLayout();
    return this.withLock(() => this.backupCurrent());
  }

  listBackups(): Promise<string[]> {
    return this.listBackupNames();
  }

  private async atomicWrite(config: Config): Promise<void> {
    const body = `${JSON.stringify(config, null, 2)}\n`;
    const tmp = join(this.root, `.${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmp, body, { mode: CONFIG_MODE });
    await chmod(tmp, CONFIG_MODE);
    await rename(tmp, this.configPath);
    await chmod(this.configPath, CONFIG_MODE);
  }

  /**
   * Exclusive lock via `config.lock` hold file created with O_EXCL (`wx`).
   * Touching `config.lock` itself records the owner pid for diagnostics.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const holdPath = `${this.lockPath}.hold`;
    let handle: FileHandle | null = null;
    const deadline = Date.now() + 10_000;
    while (handle === null) {
      try {
        handle = await open(holdPath, "wx");
        await writeFile(this.lockPath, `${process.pid}\n`, { mode: CONFIG_MODE });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (Date.now() > deadline) throw new Error("could not acquire config.lock");
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    try {
      return await fn();
    } finally {
      await handle.close();
      await rm(holdPath, { force: true });
    }
  }

  private async backupCurrent(): Promise<string | null> {
    try {
      await readFile(this.configPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${stamp}-${CONFIG_FILE}`;
    const dest = join(this.backupDir, name);
    await copyFile(this.configPath, dest);
    await this.trimBackups();
    return name;
  }

  private async listBackupNames(): Promise<string[]> {
    try {
      const names = await readdir(this.backupDir);
      return names.filter((n) => n.includes(CONFIG_FILE)).sort();
    } catch {
      return [];
    }
  }

  private async trimBackups(): Promise<void> {
    const names = await this.listBackupNames();
    if (names.length <= MAX_BACKUPS) return;
    const toDelete = names.slice(0, names.length - MAX_BACKUPS);
    for (const name of toDelete) {
      await rm(join(this.backupDir, name), { force: true });
    }
  }
}
