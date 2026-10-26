# Local GUI beta

This is the first end-to-end path you can run on your machine: daemon + CLI + loopback management UI.

## Requirements

- Node.js 22+
- pnpm 10+
- macOS recommended (keychain via `security`; Windows named pipes are not in this beta)

## Build

```bash
cd /path/to/solemcp
pnpm install
pnpm test
pnpm build
```

The binary is `dist/solemcp.mjs`. Optional:

```bash
pnpm link --global
# or
alias solemcp='node /path/to/solemcp/dist/solemcp.mjs'
```

## First run

```bash
# Keeps the daemon running after you close the terminal.
solemcp service install

# Opens the window. It does not keep the daemon alive.
solemcp ui
```

`solemcp service install` writes `~/Library/LaunchAgents/com.solemcp.daemon.plist`, bootstraps it, and sends logs to `~/.solemcp/logs`. `solemcp service uninstall` removes that agent. If a daemon was already running in a terminal, install stops it first so two processes do not share `~/.solemcp/run/daemon.sock`.

Your browser opens `http://127.0.0.1:<port>/#token=…`. The token is only in the fragment.

### In the UI

1. **Connectors → Popular MCPs** — GitHub uses GitHub sign-in. Notion, Linear, GitLab, Jira, Sentry, Vercel, Supabase, Stripe, PostHog, and Cloudflare open a browser sign-in (MCP OAuth). Filesystem asks for a path. Fetch and Playwright need no auth. All start quarantined.
2. **Custom connector** — stdio argv or HTTPS URL (optional pasted secrets still supported).
3. **Quarantine** — approve the connector (and tools when schemas change).
4. **Projects** — adopt a folder, then link one account per service. **Reads only** hides writes until you name them. **Search mode** replaces that project's tool list with search and call. Existing projects stay full-tool until you turn either switch on.
5. **Clients** — Add to Cursor / Claude / Codex.
6. **Status** — recent calls (no argument bodies) and a **Reconnect** button for a connector that is Failed. Failed stays down until you reconnect it.
7. On **Tools**, the search field queries the official MCP registry. The logo grid still works when that search cannot reach the registry.

### Wire a coding client

In the UI open the **Clients** tab:

1. **Cursor** — click **Add to Cursor** (deeplink) or **Write ~/.cursor/mcp.json**.
2. **Claude Code** — **Copy CLI** (`claude mcp add …`) or write `~/.claude.json`.
3. **Codex** — **Copy CLI** (`codex mcp add …`) or write `~/.codex/config.toml`.

Or from a terminal:

```bash
solemcp client install cursor
# or: solemcp client install claude-code
# or: solemcp client install codex
```

If `solemcp` is not on your PATH, install writes an absolute `node …/solemcp.mjs bridge` entry so clients still work.

The bridge **auto-starts** the daemon if `~/.solemcp/run/daemon.sock` is missing (so Cursor does not require a prior `solemcp daemon`). You can still run `solemcp daemon` or `solemcp ui` yourself.

Restart / reload MCP in the agent. Unadopted folders only see `solemcp__status`. Adopt the repo you care about (UI **Projects → Adopt**, or CLI):

```bash
cd ~/src/my-app
solemcp project adopt
```

## Secrets

Store values in the macOS keychain under service `solemcp`, account = ref name (e.g. `GITHUB_TOKEN`). The UI and config never display secret values.

## What this beta is not

- The macOS release tarball still needs Node.js 22. Developer ID signing runs only when `CSC_LINK` is set. npm publish is deferred. See [release.md](release.md) and [name-gate.md](name-gate.md).
- No cloud dashboard
- No Windows named-pipe daemon yet
- Live Cursor JSONC and Codex comment checks are recorded in [client-checks.md](client-checks.md). The Cursor adapter still refuses to write JSONC.
