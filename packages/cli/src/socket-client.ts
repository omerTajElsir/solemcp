import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import {
  createFrameDecoder,
  DAEMON_TOKEN_ACCOUNT,
  encodeFrame,
  parseControlRequest,
  socketPath,
  type ControlRequest,
  type ControlResponse,
  type HelloMessage,
} from "@solemcp/ipc";
import { MacKeychain } from "@solemcp/daemon";
import type { ControlClient, ControlRequestInput } from "./control-client.ts";

/**
 * Control client over the daemon Unix socket (role: cli).
 */
export class SocketControlClient implements ControlClient {
  constructor(
    private readonly home: string = process.env.SOLEMCP_HOME ?? homedir(),
    private readonly tokenProvider: () => Promise<string> = defaultDaemonToken,
  ) {}

  async request(req: ControlRequestInput): Promise<ControlResponse> {
    const full = { ...req, id: req.id ?? randomUUID() } as ControlRequest;
    parseControlRequest(full);
    const token = await this.tokenProvider();
    const path = socketPath(this.home);

    return await new Promise<ControlResponse>((resolve, reject) => {
      const socket = createConnection(path);
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };

      const onFrame = createFrameDecoder((value) => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve(value as ControlResponse);
      });

      socket.once("connect", () => {
        const hello: HelloMessage = { type: "hello", token, role: "cli" };
        socket.write(encodeFrame(hello));
        socket.write(encodeFrame(full));
      });
      socket.on("data", (chunk) => {
        try {
          onFrame(chunk);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
      socket.once("error", (err) => fail(err));
      socket.once("end", () => {
        if (!settled) fail(new Error("daemon closed the connection without a response"));
      });
    });
  }
}

async function defaultDaemonToken(): Promise<string> {
  if (process.env.SOLEMCP_TOKEN) return process.env.SOLEMCP_TOKEN;
  const keychain = new MacKeychain();
  const token = await keychain.get(DAEMON_TOKEN_ACCOUNT);
  if (!token) {
    throw new Error(
      "daemon token not found; start `solemcp daemon` first (or set SOLEMCP_TOKEN)",
    );
  }
  return token;
}
