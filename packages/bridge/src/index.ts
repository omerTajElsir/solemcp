export { resolveBridgeRoot, lastAbsolutePathArg } from "./resolve-root.ts";
export type { ResolveBridgeRootDeps } from "./resolve-root.ts";

export { createBridgeMcpServer, isForbiddenBridgeTool } from "./mcp-server.ts";
export type { BridgeMode, CreateBridgeMcpServerDeps } from "./mcp-server.ts";

export { createDaemonToolProvider } from "./tool-provider.ts";
export type { Tool, ToolProvider } from "./tool-provider.ts";

export { createBridgeServer, defaultConnect } from "./server.ts";
export type { BridgeConnect, CreateBridgeServerOptions } from "./server.ts";

export { runBridgeMain } from "./main.ts";

export { StreamTransport } from "./stream-transport.ts";
