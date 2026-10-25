# SoleMCP

SoleMCP is a local control plane for MCP servers. One bridge entry goes into Cursor, Claude Code, and Codex. A per-user daemon owns the upstream servers, and each adopted folder only sees the tools assigned to it.

New connectors and new tool schemas stay quarantined until you allow them. The bridge does not expose approve or policy tools to the model. Secrets stay in the macOS keychain.

This is the local macOS beta. Install is from source. A signed release and Homebrew formula are the next distribution step.

## Requirements

- macOS
- Node.js 22 or newer
- pnpm 10 or newer

## Install

```bash
pnpm install
pnpm test
pnpm build
```

The command is `node dist/solemcp.mjs`. To put `solemcp` on your PATH for this machine:

```bash
pnpm link --global
```

## First run

```bash
solemcp ui
```

The browser opens `http://127.0.0.1:<port>/#token=…`. The token is only in the fragment. The daemon starts if it is not already running.

Then:

1. On **Tools**, connect a ready-made server. It starts quarantined.
2. Allow it.
3. On **Projects**, link the folder your coding app has open and assign the tool.
4. On **Apps**, add SoleMCP to Cursor, Claude Code, or Codex.
5. Reload MCP in the coding app. An unadopted folder only sees `solemcp__status`.

Day-to-day use of the window is in [docs/local-gui-beta.md](docs/local-gui-beta.md). The product spec is [PLAN.md](PLAN.md).

## Commands

```text
solemcp daemon
solemcp ui
solemcp bridge [root]
solemcp project adopt [path]
solemcp approve connector <slug>
solemcp approve tool <slug> <tool>
solemcp client install <cursor|claude-code|codex>
solemcp doctor
```

`solemcp approve` refuses a piped stdin and has no `--yes`.

## Security

Report vulnerabilities privately before public disclosure. See [SECURITY.md](SECURITY.md).
