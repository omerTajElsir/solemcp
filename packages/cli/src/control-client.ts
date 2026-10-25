import { randomUUID } from "node:crypto";
import type { ControlRequest, ControlResponse } from "@solemcp/ipc";

/** Handle returned when a daemon is started in-process (tests / foreground). */
export interface DaemonHandle {
  stop(): Promise<void>;
}

/** Control request with optional id (generated if omitted). */
export type ControlRequestInput = ControlRequest extends infer R
  ? R extends ControlRequest
    ? Omit<R, "id"> & { id?: string }
    : never
  : never;

/** Injectable control-plane client used by approve, project, connector, import, doctor. */
export interface ControlClient {
  request(req: ControlRequestInput): Promise<ControlResponse>;
}

/** In-memory control client for unit tests. */
export class FakeControlClient implements ControlClient {
  readonly calls: ControlRequest[] = [];
  handler?: (req: ControlRequest) => ControlResponse | Promise<ControlResponse>;

  async request(req: ControlRequestInput): Promise<ControlResponse> {
    const full = { ...req, id: req.id ?? randomUUID() } as ControlRequest;
    this.calls.push(full);
    if (this.handler) return this.handler(full);
    return { id: full.id, ok: true, result: {} };
  }
}
