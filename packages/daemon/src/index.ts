export type { Keychain } from "./keychain.ts";
export { MemoryKeychain, MacKeychain } from "./keychain.ts";

export { ConfigStore } from "./config-store.ts";
export type { ConfigStoreOptions } from "./config-store.ts";

export type { PeerCheck } from "./peer.ts";
export { defaultPeerCheck, assertPeerAllowed } from "./peer.ts";

export { UpstreamManager } from "./upstream.ts";
export type { UpstreamStatus } from "./upstream.ts";

export {
  LAUNCH_AGENT_LABEL,
  renderLaunchAgentPlist,
  installLaunchAgent,
  uninstallLaunchAgent,
  bootstrapLaunchAgent,
  bootoutLaunchAgent,
  defaultLaunchAgentsDir,
} from "./launchd.ts";

export { startDaemon } from "./daemon.ts";
export type { DaemonOptions, DaemonHandle } from "./daemon.ts";

export { ensureDaemonRunning } from "./ensure-daemon.ts";

export { startHttpUpstream, HttpUpstreamManager } from "./http.ts";
export type {
  StartHttpUpstreamOptions,
  HttpUpstreamHandle,
  HttpUpstreamKind,
} from "./http.ts";

export { emptyConfig } from "./empty-config.ts";

export { startUiServer, resolveUiRoot } from "./ui-server.ts";
export type { UiServerHandle, UiServerHandlers, UiActivityEvent } from "./ui-server.ts";

export {
  resolveBridgeLaunch,
  resolveSolemcpEntryPath,
  cursorBridgeEntry,
  claudeBridgeEntry,
  type BridgeLaunch,
} from "./clients/bridge-launch.ts";
export {
  CURSOR_SERVER_KEY,
  CURSOR_SOLEMCP_ENTRY,
  hasJsonComments,
  installCursor,
  cursorInstalled,
  type CursorInstallOptions,
  type CursorInstallResult,
} from "./clients/cursor.ts";
export {
  CLAUDE_ADD_COMMAND,
  CLAUDE_SOLEMCP_ENTRY,
  claudeAddCommand,
  installClaudeCode,
  claudeInstalled,
  type ClaudeInstallOptions,
  type ClaudeInstallResult,
} from "./clients/claude-code.ts";
export {
  CODEX_ADD_COMMAND,
  CODEX_TOML_SNIPPET,
  codexAddCommand,
  codexTomlSnippet,
  installCodex,
  codexInstalled,
  type CodexInstallOptions,
  type CodexInstallResult,
} from "./clients/codex.ts";
export {
  buildClientConnectGuide,
  buildCursorInstallUrls,
  installClient,
  defaultClientPaths,
  type ClientName,
  type ClientConnectGuide,
  type ClientConnectCard,
} from "./clients/connect.ts";

export { POPULAR_CATALOG, getCatalogEntry } from "./catalog/popular.ts";
export type { CatalogEntry, CatalogSecretField } from "./catalog/popular.ts";
export { listPopularCatalog, prepareCatalogInstall } from "./catalog/install.ts";
