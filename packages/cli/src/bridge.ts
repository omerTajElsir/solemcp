import { runBridgeMain } from "@solemcp/bridge";

/**
 * Run the stdio bridge. Passes process argv/env so Cursor's workspaceFolder
 * argument and CLAUDE_PROJECT_DIR are available to resolveBridgeRoot.
 */
export async function runBridgeCommand(root?: string): Promise<number> {
  const argv = root ? ["bridge", root] : ["bridge"];
  await runBridgeMain(argv, process.env);
  // serveStdio keeps the process alive; if it returns, exit cleanly.
  return 0;
}
