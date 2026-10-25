import type { Duplex } from "node:stream";
import type { Transport } from "@modelcontextprotocol/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { createFrameDecoder, encodeFrame } from "@solemcp/ipc";

/**
 * Length-prefixed MCP transport over an already-open duplex
 * (Unix socket after the SoleMCP hello frame).
 * Matches the daemon's bridge session framing from @solemcp/ipc.
 */
export class StreamTransport implements Transport {
  private _started = false;
  private _closed = false;
  private readonly onData: (chunk: Buffer) => void;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly stream: Duplex) {
    this.onData = createFrameDecoder((value) => {
      this.onmessage?.(value as JSONRPCMessage);
    });
  }

  async start(): Promise<void> {
    if (this._started) throw new Error("StreamTransport already started");
    this._started = true;
    this.stream.on("data", (chunk: Buffer) => {
      try {
        this.onData(chunk);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.stream.on("error", (error: Error) => this.onerror?.(error));
    this.stream.on("end", () => void this.close());
    this.stream.on("close", () => {
      if (!this._closed) {
        this._closed = true;
        this.onclose?.();
      }
    });
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this.stream.destroy();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) throw new Error("StreamTransport is closed");
    const ok = this.stream.write(encodeFrame(message));
    if (!ok) {
      await new Promise<void>((resolve) => this.stream.once("drain", resolve));
    }
  }
}
