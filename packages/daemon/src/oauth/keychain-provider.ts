import { createHash, randomUUID } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { Keychain } from "../keychain.ts";

/**
 * Persist MCP OAuth client registration + tokens in the OS keychain.
 * Also mirrors `Bearer <access_token>` into `bearerRef` for header-based upstreams.
 */
export class KeychainOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private lastState: string | undefined;
  private authorizeUrl: URL | undefined;
  private onRedirect: ((url: URL) => void) | undefined;
  private memoryTokens: StoredOAuthTokens | undefined;
  private memoryClients = new Map<string, StoredOAuthClientInformation>();

  constructor(
    private readonly opts: {
      keychain: Keychain;
      /** Keychain namespace, e.g. `oauth:github`. */
      accountPrefix: string;
      /** Also store Authorization header value here for HttpUpstreamManager. */
      bearerRef: string;
      redirectUrl: string;
      clientName?: string;
    },
  ) {}

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName ?? "SoleMCP",
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    };
  }

  get expectedState(): string | undefined {
    return this.lastState;
  }

  get pendingAuthorizeUrl(): URL | undefined {
    return this.authorizeUrl;
  }

  setRedirectHandler(handler: (url: URL) => void): void {
    this.onRedirect = handler;
  }

  state(): string {
    this.lastState = randomUUID();
    return this.lastState;
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext,
  ): Promise<StoredOAuthClientInformation | undefined> {
    if (!ctx?.issuer) return undefined;
    const key = this.clientKey(ctx.issuer);
    if (this.memoryClients.has(key)) return this.memoryClients.get(key);
    const raw = await this.opts.keychain.get(key);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredOAuthClientInformation;
      this.memoryClients.set(key, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  async saveClientInformation(
    info: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    if (!ctx?.issuer) return;
    const key = this.clientKey(ctx.issuer);
    this.memoryClients.set(key, info);
    await this.opts.keychain.set(key, JSON.stringify(info));
  }

  async tokens(
    ctx?: OAuthClientInformationContext,
  ): Promise<StoredOAuthTokens | undefined> {
    if (ctx === undefined && this.memoryTokens) return this.memoryTokens;
    const raw = await this.opts.keychain.get(this.tokensKey());
    if (!raw) return this.memoryTokens;
    try {
      const parsed = JSON.parse(raw) as StoredOAuthTokens;
      this.memoryTokens = parsed;
      return parsed;
    } catch {
      return this.memoryTokens;
    }
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    _ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    this.memoryTokens = tokens;
    await this.opts.keychain.set(this.tokensKey(), JSON.stringify(tokens));
    // Mirror for existing headerRefs-based HTTP upstream path.
    await this.opts.keychain.set(
      this.opts.bearerRef,
      `Bearer ${tokens.access_token}`,
    );
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.authorizeUrl = authorizationUrl;
    this.onRedirect?.(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.verifier = codeVerifier;
    await this.opts.keychain.set(this.verifierKey(), codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    if (this.verifier) return this.verifier;
    const stored = await this.opts.keychain.get(this.verifierKey());
    if (!stored) throw new Error("missing OAuth PKCE verifier");
    this.verifier = stored;
    return stored;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.discovery = state;
    await this.opts.keychain.set(this.discoveryKey(), JSON.stringify(state));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.discovery) return this.discovery;
    const raw = await this.opts.keychain.get(this.discoveryKey());
    if (!raw) return undefined;
    try {
      this.discovery = JSON.parse(raw) as OAuthDiscoveryState;
      return this.discovery;
    } catch {
      return undefined;
    }
  }

  private clientKey(issuer: string): string {
    const digest = createHash("sha256").update(issuer).digest("hex").slice(0, 16);
    return `${this.opts.accountPrefix}:client:${digest}`;
  }

  private tokensKey(): string {
    return `${this.opts.accountPrefix}:tokens`;
  }

  private verifierKey(): string {
    return `${this.opts.accountPrefix}:verifier`;
  }

  private discoveryKey(): string {
    return `${this.opts.accountPrefix}:discovery`;
  }
}
