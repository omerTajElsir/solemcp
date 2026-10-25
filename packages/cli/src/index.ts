import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { redact } from "@solemcp/core";
import { ArgvError, parseArgv, type ClientName } from "./argv.ts";
import { exportClientEntry } from "./adapters/export.ts";
import { previewImport, type ImportSourceFile } from "./adapters/import.ts";
import { resolveBridgeLaunch } from "@solemcp/daemon";
import { installCursor } from "./adapters/cursor.ts";
import { installClaudeCode, CLAUDE_ADD_COMMAND } from "./adapters/claude-code.ts";
import { installCodex, CODEX_ADD_COMMAND } from "./adapters/codex.ts";
import { runBridgeCommand } from "./bridge.ts";
import {
  FakeControlClient,
  type ControlClient,
  type DaemonHandle,
} from "./control-client.ts";
import { runDaemonCommand } from "./daemon.ts";
import {
  formatDoctorReport,
  missingSecretRefReport,
  type DoctorReport,
} from "./doctor.ts";
import { SocketControlClient } from "./socket-client.ts";
import { runUiCommand, uiHelpLine } from "./ui.ts";

export type { ControlClient, DaemonHandle, DoctorReport, ImportSourceFile };
export type { ClientName };
export {
  FakeControlClient,
  previewImport,
  installCursor,
  installClaudeCode,
  installCodex,
  exportClientEntry,
  formatDoctorReport,
  missingSecretRefReport,
  CLAUDE_ADD_COMMAND,
  CODEX_ADD_COMMAND,
};
export { backupFile, rollbackFile } from "./backup.ts";
export { hasJsonComments, CURSOR_SOLEMCP_ENTRY } from "./adapters/cursor.ts";
export { parseArgv, ArgvError } from "./argv.ts";

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface CliDeps {
  controlClient?: ControlClient;
  /** Override for tests; defaults to process.stdin.isTTY. */
  stdinIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
  /** Injected doctor report (skips control client). */
  doctorReport?: DoctorReport;
  /** Secret values to redact from any printed control errors. */
  secretValues?: string[];
}

const HELP = `solemcp — local MCP control plane

Commands:
  daemon
  bridge [root]
  approve connector <slug>
  approve tool <slug> <tool>
  project adopt [path]
  project list
  project pin <path>
  connector add --slug <slug> --stdio -- <argv...>
  connector add --slug <slug> --url <url>
  connector assign <slug> <projectId>
  client install <cursor|claude-code|codex>
  client export --format json|toml
  client import [--confirm] [--file <client> <path>]...
  backup
  rollback [id]
  doctor
  ${uiHelpLine()}
`;

function defaultIo(): CliIo {
  return {
    stdout: (line) => process.stdout.write(line.endsWith("\n") ? line : `${line}\n`),
    stderr: (line) => process.stderr.write(line.endsWith("\n") ? line : `${line}\n`),
  };
}

function requireClient(deps: CliDeps): ControlClient {
  if (deps.controlClient) return deps.controlClient;
  return new SocketControlClient();
}

function resolveClientPath(
  client: ClientName,
  env: NodeJS.ProcessEnv,
  override?: string,
): string {
  if (override) return override;
  if (client === "cursor") {
    return env.SOLEMCP_CURSOR_MCP ?? join(homedir(), ".cursor", "mcp.json");
  }
  if (client === "claude-code") {
    return env.SOLEMCP_CLAUDE ?? join(homedir(), ".claude.json");
  }
  return env.SOLEMCP_CODEX ?? join(homedir(), ".codex", "config.toml");
}

function defaultBackupDir(env: NodeJS.ProcessEnv, explicit?: string): string {
  if (explicit) return explicit;
  if (env.SOLEMCP_BACKUP_DIR) return env.SOLEMCP_BACKUP_DIR;
  return join(homedir(), ".solemcp", "backups");
}

/**
 * Run the SoleMCP CLI. Returns a process exit code.
 * Pass `argv` without the node/script prefix (same as process.argv.slice(2)).
 */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo();
  const env = deps.env ?? process.env;
  const secrets = deps.secretValues ?? [];
  const printErr = (msg: string) => io.stderr(redact(msg, secrets));
  const printOut = (msg: string) => io.stdout(redact(msg, secrets));

  let command;
  try {
    command = parseArgv(argv);
  } catch (err) {
    printErr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    switch (command.name) {
      case "help":
        printOut(HELP);
        return 0;

      case "daemon":
        return runDaemonCommand();

      case "bridge":
        return runBridgeCommand(command.root);

      case "ui":
        return runUiCommand({
          stdinIsTTY: deps.stdinIsTTY ?? Boolean(process.stdin.isTTY),
        });

      case "approve-connector": {
        const isTTY = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY);
        if (!isTTY) {
          printErr("approve requires a TTY; refusing non-interactive stdin");
          return 1;
        }
        const client = requireClient(deps);
        const res = await client.request({
          method: "approveConnector",
          slug: command.slug,
        });
        if (!res.ok) {
          printErr(res.error ?? "approve connector failed");
          return 1;
        }
        printOut(`approved connector ${command.slug}`);
        return 0;
      }

      case "approve-tool": {
        const isTTY = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY);
        if (!isTTY) {
          printErr("approve requires a TTY; refusing non-interactive stdin");
          return 1;
        }
        const client = requireClient(deps);
        const res = await client.request({
          method: "approveTool",
          slug: command.slug,
          tool: command.tool,
        });
        if (!res.ok) {
          printErr(res.error ?? "approve tool failed");
          return 1;
        }
        printOut(`approved tool ${command.slug}/${command.tool}`);
        return 0;
      }

      case "project-adopt": {
        const client = requireClient(deps);
        const path = command.path ?? process.cwd();
        const res = await client.request({ method: "adopt", path });
        if (!res.ok) {
          printErr(res.error ?? "adopt failed");
          return 1;
        }
        printOut(JSON.stringify(res.result ?? { path }, null, 2));
        return 0;
      }

      case "project-list": {
        const client = requireClient(deps);
        const res = await client.request({ method: "listProjects" });
        if (!res.ok) {
          printErr(res.error ?? "listProjects failed");
          return 1;
        }
        printOut(JSON.stringify(res.result ?? [], null, 2));
        return 0;
      }

      case "project-pin": {
        const client = requireClient(deps);
        const sessionKey = env.SOLEMCP_SESSION_KEY ?? "default";
        const res = await client.request({
          method: "pin",
          path: command.path,
          sessionKey,
        });
        if (!res.ok) {
          printErr(res.error ?? "pin failed");
          return 1;
        }
        printOut(`pinned ${command.path}`);
        return 0;
      }

      case "connector-add": {
        const client = requireClient(deps);
        const res = await client.request({
          method: "connectorAdd",
          slug: command.slug,
          transport: command.transport,
          ...(command.argv ? { argv: command.argv } : {}),
          ...(command.url ? { url: command.url } : {}),
        });
        if (!res.ok) {
          printErr(res.error ?? "connector add failed");
          return 1;
        }
        printOut(`added connector ${command.slug} (quarantined)`);
        return 0;
      }

      case "connector-assign": {
        const client = requireClient(deps);
        const res = await client.request({
          method: "connectorAssign",
          slug: command.slug,
          projectId: command.projectId,
        });
        if (!res.ok) {
          printErr(res.error ?? "connector assign failed");
          return 1;
        }
        printOut(`assigned ${command.slug} → ${command.projectId}`);
        return 0;
      }

      case "client-install": {
        const configPath = resolveClientPath(command.client, env, command.configPath);
        const backupDir = defaultBackupDir(env, command.backupDir);
        const launch = resolveBridgeLaunch();
        if (command.client === "cursor") {
          const result = await installCursor({ configPath, backupDir, launch });
          if (result.reason && !result.wrote) {
            if (result.reason === "already installed") {
              printOut("cursor: solemcp entry already installed");
              return 0;
            }
            printErr(result.reason);
            return 1;
          }
          printOut(`cursor: installed solemcp into ${configPath}`);
          return 0;
        }
        if (command.client === "claude-code") {
          const result = await installClaudeCode({
            configPath,
            backupDir,
            dryRun: command.dryRun,
            launch,
          });
          if (result.printedCommand) {
            printOut(result.printedCommand);
            return 0;
          }
          if (result.reason === "already installed") {
            printOut("claude-code: solemcp entry already installed");
            return 0;
          }
          if (!result.wrote && result.reason) {
            printErr(result.reason);
            return 1;
          }
          printOut(`claude-code: installed solemcp into ${configPath}`);
          return 0;
        }
        {
          const result = await installCodex({
            configPath,
            backupDir,
            dryRun: command.dryRun,
            launch,
          });
          if (result.printedCommand) {
            printOut(result.printedCommand);
            return 0;
          }
          if (result.reason === "already installed") {
            printOut("codex: solemcp entry already installed");
            return 0;
          }
          if (!result.wrote && result.reason) {
            printErr(result.reason);
            return 1;
          }
          printOut(`codex: installed solemcp into ${configPath}`);
          return 0;
        }
      }

      case "client-export": {
        printOut(exportClientEntry(command.format));
        return 0;
      }

      case "client-import": {
        const sources: ImportSourceFile[] = [];
        for (const f of command.files ?? []) {
          const text = await readFile(f.path, "utf8");
          sources.push({ client: f.client, path: f.path, text });
        }
        const preview = previewImport(sources);
        printOut(JSON.stringify(preview, null, 2));
        if (!command.confirm) {
          printOut("import preview only; pass --confirm to apply via control client");
          return 0;
        }
        const client = requireClient(deps);
        const apply = await client.request({
          method: "importApply",
          confirmRemove: false,
        });
        if (!apply.ok) {
          printErr(apply.error ?? "import apply failed");
          return 1;
        }
        printOut("import applied");
        return 0;
      }

      case "backup": {
        const client = requireClient(deps);
        const res = await client.request({ method: "backup" });
        if (!res.ok) {
          printErr(res.error ?? "backup failed");
          return 1;
        }
        printOut(JSON.stringify(res.result ?? {}, null, 2));
        return 0;
      }

      case "rollback": {
        const client = requireClient(deps);
        const res = await client.request({
          method: "rollback",
          ...(command.id ? { backupId: command.id } : {}),
        });
        if (!res.ok) {
          printErr(res.error ?? "rollback failed");
          return 1;
        }
        printOut(JSON.stringify(res.result ?? {}, null, 2));
        return 0;
      }

      case "doctor": {
        let report: DoctorReport;
        if (deps.doctorReport) {
          report = deps.doctorReport;
        } else if (deps.controlClient) {
          const res = await deps.controlClient.request({ method: "doctor" });
          if (!res.ok) {
            report = {
              readable: false,
              findings: [
                {
                  severity: "error",
                  code: "doctor-rpc",
                  message: res.error ?? "doctor failed",
                },
              ],
              secretValues: secrets,
            };
          } else {
            report = (res.result as DoctorReport) ?? {
              readable: true,
              findings: [],
              secretValues: secrets,
            };
            if (!report.secretValues) report.secretValues = secrets;
          }
        } else {
          report = { readable: true, findings: [], secretValues: secrets };
        }
        const { exitCode, output } = formatDoctorReport(report);
        printOut(output);
        return exitCode;
      }

      default: {
        const _exhaustive: never = command;
        void _exhaustive;
        printErr("unhandled command");
        return 1;
      }
    }
  } catch (err) {
    if (err instanceof ArgvError) {
      printErr(err.message);
      return 1;
    }
    printErr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
