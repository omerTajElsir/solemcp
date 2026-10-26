# Client checks

PLAN.md §17 live checks. Recorded 2026-10-26 on this Mac. Versions are only what the local CLIs printed. A row marked not observed was not exercised against a running client session.

| Check | Client | Result |
| --- | --- | --- |
| Cursor `roots/list` | Cursor 3.24.18 (`be4c9e5350d77747b42cd467cbd3370a753d4640`, arm64), from `cursor --version` | Not observed. No MCP session was attached to see whether Cursor answers `roots/list`. |
| Cursor `notifications/tools/list_changed` | Cursor 3.24.18, same command | Not observed. PLAN.md notes a June 2026 conformance report that Cursor did not support this notification. That report was not re-run against 3.24.18. The bridge keeps a fixed tool list for the connection. |
| Codex cwd when the server is spawned | Codex CLI | Not observed. `codex` is not on PATH. |
| Codex CLI versus Codex Desktop refresh (`tools/list_changed`) | Codex CLI and Codex Desktop | Not observed. The CLI is not installed, and Desktop was not exercised. |
| JSONC comments in Cursor `mcp.json` | Cursor adapter in this repo; Cursor 3.24.18 was not asked to parse a comment file | The adapter refuses to write a comment-bearing `mcp.json`. `installCursor` returns without writing when `hasJsonComments` is true. Live Cursor parse of JSONC was not observed. Pure JSON writes are unchanged. |
| Comment preservation in Codex TOML | Codex adapter in this repo | Not observed in Codex. The CLI is not installed. The adapter refuses to rewrite `config.toml` when a line comment is present and SoleMCP is not already installed, and tells the person to use `codex mcp add` instead. |

Claude Code 2.0.57 was installed (`claude --version`). It is not one of the six rows.
