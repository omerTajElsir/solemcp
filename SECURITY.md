# Security

SoleMCP is a local control plane. Report vulnerabilities privately to [omertaj39@gmail.com](mailto:omertaj39@gmail.com) before public disclosure.

## Trust boundaries

- The MCP bridge exposes tools to the model. It never exposes approve, policy, or connector-mutation tools.
- Approval requires a TTY CLI command or a loopback UI session minted by `solemcp ui` (also TTY-only). There is no `--yes`.
- The daemon data plane is a Unix socket (`~/.solemcp/run/daemon.sock`) with mode `0600`, peer-uid checks when available, and a keychain-backed token.
- The management UI binds `127.0.0.1` only. The session token is passed in the URL fragment, not a query string. Host and Origin must match loopback.
- Secret values live in the OS keychain (or a warned file fallback). `config.json` stores secret names only.
- A committed `.solemcp/project.json` cannot approve commands or contain argv, URLs with credentials, or env values.

## Supply chain (public beta path)

Signed releases, checksums, and npm provenance are planned for the full M4 distribution milestone. This local GUI beta is intended to be built from source via `pnpm build`.
