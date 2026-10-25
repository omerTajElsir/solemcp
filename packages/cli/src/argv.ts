export type ClientName = "cursor" | "claude-code" | "codex";

export type ParsedCommand =
  | { name: "daemon" }
  | { name: "bridge"; root?: string }
  | { name: "approve-connector"; slug: string }
  | { name: "approve-tool"; slug: string; tool: string }
  | { name: "project-adopt"; path?: string }
  | { name: "project-list" }
  | { name: "project-pin"; path: string }
  | {
      name: "connector-add";
      slug: string;
      transport: "stdio" | "http";
      argv?: string[];
      url?: string;
    }
  | { name: "connector-assign"; slug: string; projectId: string }
  | {
      name: "client-install";
      client: ClientName;
      configPath?: string;
      backupDir?: string;
      dryRun?: boolean;
    }
  | { name: "client-export"; format: "json" | "toml" }
  | {
      name: "client-import";
      confirm?: boolean;
      files?: { client: ClientName; path: string }[];
    }
  | { name: "backup" }
  | { name: "rollback"; id?: string }
  | { name: "doctor" }
  | { name: "ui" }
  | { name: "help" };

export class ArgvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgvError";
  }
}

/**
 * Small argv parser. `argv` should be process.argv.slice(2) (no node/script).
 */
export function parseArgv(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return { name: "help" };
  }

  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "daemon":
      return { name: "daemon" };
    case "bridge":
      return { name: "bridge", root: rest[0] };
    case "approve":
      return parseApprove(rest);
    case "project":
      return parseProject(rest);
    case "connector":
      return parseConnector(rest);
    case "client":
      return parseClient(rest);
    case "backup":
      return { name: "backup" };
    case "rollback":
      return { name: "rollback", id: rest[0] };
    case "doctor":
      return { name: "doctor" };
    case "ui":
      return { name: "ui" };
    default:
      throw new ArgvError(`unknown command: ${cmd}`);
  }
}

function parseApprove(rest: readonly string[]): ParsedCommand {
  if (rest[0] === "connector") {
    const slug = rest[1];
    if (!slug) throw new ArgvError("usage: solemcp approve connector <slug>");
    if (rest.includes("--yes")) {
      throw new ArgvError("approve does not accept --yes");
    }
    return { name: "approve-connector", slug };
  }
  if (rest[0] === "tool") {
    const slug = rest[1];
    const tool = rest[2];
    if (!slug || !tool) throw new ArgvError("usage: solemcp approve tool <slug> <tool>");
    if (rest.includes("--yes")) {
      throw new ArgvError("approve does not accept --yes");
    }
    return { name: "approve-tool", slug, tool };
  }
  throw new ArgvError("usage: solemcp approve connector|tool ...");
}

function parseProject(rest: readonly string[]): ParsedCommand {
  const sub = rest[0];
  if (sub === "adopt") return { name: "project-adopt", path: rest[1] };
  if (sub === "list") return { name: "project-list" };
  if (sub === "pin") {
    const path = rest[1];
    if (!path) throw new ArgvError("usage: solemcp project pin <path>");
    return { name: "project-pin", path };
  }
  throw new ArgvError("usage: solemcp project adopt|list|pin ...");
}

function parseConnector(rest: readonly string[]): ParsedCommand {
  const sub = rest[0];
  if (sub === "assign") {
    const slug = rest[1];
    const projectId = rest[2];
    if (!slug || !projectId) {
      throw new ArgvError("usage: solemcp connector assign <slug> <projectId>");
    }
    return { name: "connector-assign", slug, projectId };
  }
  if (sub === "add") {
    return parseConnectorAdd(rest.slice(1));
  }
  throw new ArgvError("usage: solemcp connector add|assign ...");
}

function parseConnectorAdd(args: readonly string[]): ParsedCommand {
  let slug: string | undefined;
  let transport: "stdio" | "http" | undefined;
  let url: string | undefined;
  let argv: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--slug") {
      slug = args[++i];
      continue;
    }
    if (a === "--stdio") {
      transport = "stdio";
      continue;
    }
    if (a === "--url") {
      transport = "http";
      url = args[++i];
      continue;
    }
    if (a === "--") {
      argv = args.slice(i + 1).map(String);
      break;
    }
    // Positional argv after flags when --stdio without --
    if (!a.startsWith("-") && transport === "stdio" && !argv) {
      argv = args.slice(i).map(String);
      break;
    }
  }

  if (!slug) throw new ArgvError("connector add requires --slug");
  if (!transport) {
    throw new ArgvError("connector add requires --stdio or --url");
  }
  if (transport === "stdio" && (!argv || argv.length === 0)) {
    throw new ArgvError("connector add --stdio requires argv (use -- …)");
  }
  if (transport === "http" && !url) {
    throw new ArgvError("connector add --url requires a URL");
  }

  return {
    name: "connector-add",
    slug,
    transport,
    ...(transport === "stdio" ? { argv } : { url }),
  };
}

function parseClient(rest: readonly string[]): ParsedCommand {
  const sub = rest[0];
  if (sub === "install") {
    const client = rest[1];
    if (client !== "cursor" && client !== "claude-code" && client !== "codex") {
      throw new ArgvError("usage: solemcp client install <cursor|claude-code|codex>");
    }
    let configPath: string | undefined;
    let backupDir: string | undefined;
    let dryRun = false;
    for (let i = 2; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--config" || a === "--path") {
        configPath = rest[++i];
      } else if (a === "--backup-dir") {
        backupDir = rest[++i];
      } else if (a === "--dry-run") {
        dryRun = true;
      }
    }
    return { name: "client-install", client, configPath, backupDir, dryRun };
  }
  if (sub === "export") {
    let format: "json" | "toml" = "json";
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--format") {
        const f = rest[++i];
        if (f !== "json" && f !== "toml") {
          throw new ArgvError("--format must be json or toml");
        }
        format = f;
      }
    }
    return { name: "client-export", format };
  }
  if (sub === "import") {
    let confirm = false;
    const files: { client: ClientName; path: string }[] = [];
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--confirm") {
        confirm = true;
      } else if (a === "--file") {
        const client = rest[++i] as ClientName;
        const path = rest[++i];
        if (!client || !path) throw new ArgvError("--file needs <client> <path>");
        files.push({ client, path });
      }
    }
    return {
      name: "client-import",
      confirm,
      files: files.length > 0 ? files : undefined,
    };
  }
  throw new ArgvError("usage: solemcp client install|export|import ...");
}
