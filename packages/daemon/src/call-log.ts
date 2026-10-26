import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redactForLog } from "@solemcp/core";

export const CALL_LOG_LIMIT = 100;

export type CallLogEntry = {
  at: string;
  projectId: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

export type CallLogInput = {
  projectId: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  /** Error text. Redacted before it is stored. Argument objects are ignored. */
  errorText?: string;
  /** Result text. Scanned so secrets are not written. The body is not stored. */
  resultText?: string;
  secretValues?: readonly string[];
};

/**
 * Bounded call log. Entries are project, tool, outcome, and duration.
 * Argument bodies are never stored. Result bodies are never stored.
 */
export class CallLog {
  private entries: CallLogEntry[] = [];

  constructor(
    private readonly filePath: string,
    private readonly limit = CALL_LOG_LIMIT,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) {
        this.entries = [];
        return;
      }
      this.entries = parsed.entries
        .filter(isCallLogEntry)
        .slice(0, this.limit)
        .map(publicEntry);
    } catch {
      this.entries = [];
    }
  }

  recent(): CallLogEntry[] {
    return this.entries.map(publicEntry);
  }

  async record(input: CallLogInput): Promise<CallLogEntry> {
    const secrets = input.secretValues ?? [];
    if (input.resultText) {
      redactForLog(input.resultText, secrets);
    }
    const error = input.errorText ? redactForLog(input.errorText, secrets) : undefined;
    const entry: CallLogEntry = {
      at: new Date().toISOString(),
      projectId: input.projectId,
      tool: input.tool,
      ok: input.ok,
      durationMs: input.durationMs,
      ...(error ? { error } : {}),
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    await this.persist();
    return publicEntry(entry);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const body = JSON.stringify({ entries: this.entries.map(publicEntry) });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

function publicEntry(entry: CallLogEntry): CallLogEntry {
  return {
    at: entry.at,
    projectId: entry.projectId,
    tool: entry.tool,
    ok: entry.ok,
    durationMs: entry.durationMs,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function isCallLogEntry(value: unknown): value is CallLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === "string" &&
    (typeof entry.projectId === "string" || entry.projectId === null) &&
    typeof entry.tool === "string" &&
    typeof entry.ok === "boolean" &&
    typeof entry.durationMs === "number"
  );
}
