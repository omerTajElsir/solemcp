import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type { Keychain } from "../keychain.ts";
import type { CatalogEntry } from "../catalog/popular.ts";
import { KeychainOAuthProvider } from "./keychain-provider.ts";
import { startOAuthCallbackServer, type OAuthCallbackServer } from "./callback-server.ts";

export type OAuthInstallStatus = {
  sessionId: string;
  status: "awaiting_user" | "complete" | "error";
  authorizeUrl?: string;
  slug?: string;
  connectorId?: string;
  error?: string;
};

type Session = {
  id: string;
  entry: CatalogEntry;
  provider: KeychainOAuthProvider;
  transport: StreamableHTTPClientTransport;
  serverUrl: URL;
  status: OAuthInstallStatus["status"];
  authorizeUrl?: string;
  error?: string;
  connectorId?: string;
  slug?: string;
  done: Promise<void>;
};

/**
 * Runs MCP OAuth (browser) for a catalog HTTP entry, then invokes `onAuthorized`
 * so the daemon can create the quarantined connector.
 */
export class OAuthInstallManager {
  private callback: OAuthCallbackServer | null = null;
  private sessions = new Map<string, Session>();

  constructor(private readonly keychain: Keychain) {}

  getStatus(sessionId: string): OAuthInstallStatus | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return {
      sessionId: s.id,
      status: s.status,
      authorizeUrl: s.authorizeUrl,
      slug: s.slug,
      connectorId: s.connectorId,
      error: s.error,
    };
  }

  async start(
    entry: CatalogEntry,
    onAuthorized: (payload: {
      slug: string;
      url: string;
      sseFallback: boolean;
      bearerRef: string;
    }) => Promise<{ id: string; slug: string }>,
  ): Promise<OAuthInstallStatus> {
    if (entry.transport !== "http" || !entry.url) {
      throw new Error("OAuth is only supported for HTTP catalog entries");
    }

    if (!this.callback) {
      this.callback = await startOAuthCallbackServer();
    }

    const bearerRef = entry.oauthBearerRef ?? `${entry.slug.toUpperCase()}_OAUTH_TOKEN`;
    const accountPrefix = `oauth:${entry.slug}`;
    const provider = new KeychainOAuthProvider({
      keychain: this.keychain,
      accountPrefix,
      bearerRef,
      redirectUrl: this.callback.redirectUrl,
      clientName: `SoleMCP (${entry.title})`,
    });

    const serverUrl = new URL(entry.url);
    let authorizeResolve: ((url: URL) => void) | undefined;
    const authorizePromise = new Promise<URL>((resolve) => {
      authorizeResolve = resolve;
    });
    provider.setRedirectHandler((url) => {
      authorizeResolve?.(url);
    });

    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider: provider,
    });
    const client = new Client({ name: "solemcp", version: "0.0.0" });

    const sessionId = randomUUID();
    const session: Session = {
      id: sessionId,
      entry,
      provider,
      transport,
      serverUrl,
      status: "awaiting_user",
      done: Promise.resolve(),
    };
    this.sessions.set(sessionId, session);

    // Kick off connect; UnauthorizedError means browser login is required.
    const connectAttempt = client.connect(transport).then(
      () => "connected" as const,
      (err: unknown) => {
        if (err instanceof UnauthorizedError) return "unauthorized" as const;
        throw err;
      },
    );

    const outcome = await Promise.race([
      connectAttempt,
      authorizePromise.then(() => "redirect" as const),
    ]);

    if (outcome === "connected") {
      // Already had tokens.
      const result = await onAuthorized({
        slug: entry.slug,
        url: entry.url,
        sseFallback: entry.sseFallback ?? true,
        bearerRef,
      });
      session.status = "complete";
      session.connectorId = result.id;
      session.slug = result.slug;
      await client.close().catch(() => undefined);
      return this.getStatus(sessionId)!;
    }

    const authorizeUrl = session.provider.pendingAuthorizeUrl ?? (await authorizePromise);
    session.authorizeUrl = authorizeUrl.href;

    session.done = (async () => {
      try {
        // Ensure UnauthorizedError path finished (redirect already happened).
        await connectAttempt.catch(() => undefined);

        const expectedState = provider.expectedState;
        if (!expectedState) throw new Error("OAuth state missing");
        if (!this.callback) throw new Error("OAuth callback server missing");

        const callbackUrl = await this.callback.waitForCallback(expectedState);
        const params = callbackUrl.searchParams;
        if (params.get("state") !== expectedState) {
          throw new Error("OAuth state mismatch");
        }
        if (params.get("error")) {
          throw new Error("authorization denied in browser");
        }

        await transport.finishAuth(params);

        const fresh = new StreamableHTTPClientTransport(serverUrl, {
          authProvider: provider,
        });
        const client2 = new Client({ name: "solemcp", version: "0.0.0" });
        await client2.connect(fresh);
        await client2.close().catch(() => undefined);

        const result = await onAuthorized({
          slug: entry.slug,
          url: entry.url!,
          sseFallback: entry.sseFallback ?? true,
          bearerRef,
        });
        session.status = "complete";
        session.connectorId = result.id;
        session.slug = result.slug;
      } catch (err) {
        session.status = "error";
        session.error = err instanceof Error ? err.message : String(err);
      } finally {
        await client.close().catch(() => undefined);
      }
    })();

    return this.getStatus(sessionId)!;
  }

  async wait(sessionId: string): Promise<OAuthInstallStatus> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("unknown OAuth session");
    await s.done;
    return this.getStatus(sessionId)!;
  }

  async close(): Promise<void> {
    if (this.callback) {
      await this.callback.close().catch(() => undefined);
      this.callback = null;
    }
    this.sessions.clear();
  }
}
