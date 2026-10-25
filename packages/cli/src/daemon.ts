import { homedir } from "node:os";
import { MacKeychain, startDaemon } from "@solemcp/daemon";

/**
 * Start the foreground daemon with the OS keychain and the user's home.
 * SOLEMCP_HOME overrides the home directory used for ~/.solemcp.
 */
export async function runDaemonCommand(): Promise<number> {
  const home = process.env.SOLEMCP_HOME ?? homedir();
  const handle = await startDaemon({
    home,
    keychain: new MacKeychain(),
  });

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  // Foreground: wait until signaled.
  await new Promise<void>(() => {
    /* kept alive by daemon socket */
  });
  return 0;
}
