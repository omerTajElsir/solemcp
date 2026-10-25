import type { Socket } from "node:net";

/**
 * Returns the peer uid for a connected Unix socket, or null when unavailable.
 * Tests inject a stub; production uses {@link defaultPeerCheck}.
 */
export type PeerCheck = (socket: Socket) => number | null;

/**
 * Best-effort peer uid on Darwin. Returns null when getpeereid is unavailable
 * (typical in stock Node builds). Callers that receive null skip the uid check.
 */
export function defaultPeerCheck(socket: Socket): number | null {
  try {
    // Node does not expose getpeereid. Some builds stash credentials on the handle.
    const handle = (socket as unknown as { _handle?: { getPeerCredentials?: () => { uid?: number } } })
      ._handle;
    const creds = handle?.getPeerCredentials?.();
    if (creds && typeof creds.uid === "number") return creds.uid;
  } catch {
    // ignore
  }
  return null;
}

/** Reject when peer uid is known and differs from the daemon uid. */
export function assertPeerAllowed(
  socket: Socket,
  peerCheck: PeerCheck,
  daemonUid: number = process.getuid?.() ?? -1,
): void {
  const peerUid = peerCheck(socket);
  if (peerUid === null) return;
  if (peerUid !== daemonUid) {
    throw new Error("peer uid mismatch");
  }
}
