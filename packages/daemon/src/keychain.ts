import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KEYCHAIN_SERVICE } from "@solemcp/ipc";

const execFileAsync = promisify(execFile);

/** OS or in-memory secret store. Values must never be logged. */
export interface Keychain {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** In-memory keychain for tests. */
export class MemoryKeychain implements Keychain {
  private readonly store = new Map<string, string>();

  async get(account: string): Promise<string | null> {
    return this.store.get(account) ?? null;
  }

  async set(account: string, value: string): Promise<void> {
    this.store.set(account, value);
  }

  async delete(account: string): Promise<void> {
    this.store.delete(account);
  }
}

/**
 * macOS Keychain via the `security` CLI.
 * Never logs secret values.
 */
export class MacKeychain implements Keychain {
  constructor(private readonly service: string = KEYCHAIN_SERVICE) {}

  async get(account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", this.service, "-a", account, "-w"],
        { encoding: "utf8" },
      );
      const value = stdout.replace(/\n$/, "");
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async set(account: string, value: string): Promise<void> {
    // Delete first so add does not fail on update.
    await this.delete(account).catch(() => undefined);
    await execFileAsync(
      "security",
      [
        "add-generic-password",
        "-s",
        this.service,
        "-a",
        account,
        "-w",
        value,
        "-U",
      ],
      { encoding: "utf8" },
    );
  }

  async delete(account: string): Promise<void> {
    try {
      await execFileAsync(
        "security",
        ["delete-generic-password", "-s", this.service, "-a", account],
        { encoding: "utf8" },
      );
    } catch {
      // Absent account is fine.
    }
  }
}
