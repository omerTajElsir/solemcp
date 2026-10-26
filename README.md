# SoleMCP

SoleMCP is a local control plane for MCP servers. One bridge entry goes into Cursor, Claude Code, and Codex. A per-user daemon owns the upstream servers, and each adopted folder only sees the tools assigned to it.

New connectors and new tool schemas stay quarantined until you allow them. The bridge does not expose approve or policy tools to the model. Secrets stay in the macOS keychain.

This is the local macOS beta. Install is from source, or from the versioned tarball described in [docs/release.md](docs/release.md). The tarball still needs Node.js 22. A Developer ID signature is applied in GitHub Actions only when `CSC_LINK` is set; otherwise that step is skipped and checksums are still published. npm publish is deferred ([docs/name-gate.md](docs/name-gate.md)).

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
solemcp service install
solemcp service uninstall
solemcp bridge [root]
solemcp project adopt [path]
solemcp approve connector <slug>
solemcp approve tool <slug> <tool>
solemcp client install <cursor|claude-code|codex>
solemcp doctor
```

`solemcp ui` only opens the window. `solemcp service install` writes a LaunchAgent that starts the daemon at login, restarts it if it exits, and logs under `~/.solemcp/logs`. `solemcp approve` refuses a piped stdin and has no `--yes`.

On a project card, **Reads only** lets tools marked `readOnlyHint` run and keeps unannotated or destructive tools hidden until they are named in an allow list. **Search mode** advertises `solemcp__search` and `solemcp__call` instead of the full tool list. Existing projects stay full-tool until you turn those on.

The Tools page can search the official MCP registry at `https://registry.modelcontextprotocol.io/v0.1/servers`. A chosen server is installed through the same quarantine and keychain path as any other connector. If the registry is unreachable, the ready-made grid still works.

Status lists recent calls (project, tool, ok or fail, duration) without argument bodies. A connector that has failed stays stopped until you reconnect it.

## Security

Report vulnerabilities privately before public disclosure. See [SECURITY.md](SECURITY.md).

Name and client notes: [docs/name-gate.md](docs/name-gate.md), [docs/client-checks.md](docs/client-checks.md). Release: [docs/release.md](docs/release.md).
