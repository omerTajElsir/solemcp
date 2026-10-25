/**
 * Curated one-click connectors for the local GUI beta.
 * Prefer browser OAuth for hosted HTTP MCPs; secrets only when OAuth is unavailable.
 */
export type CatalogSecretField = {
  /** Keychain account / env name injected into the upstream process. */
  ref: string;
  label: string;
  help: string;
  /** When set, stored value is `${prefix}${userInput}` (e.g. `Bearer `). */
  valuePrefix?: string;
  /** If set, this secret is used as an HTTP header via headerRefs. */
  header?: string;
};

export type CatalogAuthMode = "oauth" | "github" | "secret" | "none";

export type CatalogEntry = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  transport: "stdio" | "http";
  authMode: CatalogAuthMode;
  /** stdio argv; use `{{path}}` for filesystem root. */
  argv?: string[];
  url?: string;
  sseFallback?: boolean;
  /** Keychain account for mirrored Bearer token after OAuth. */
  oauthBearerRef?: string;
  secrets: CatalogSecretField[];
  needsPath?: boolean;
  pathLabel?: string;
  pathPlaceholder?: string;
  docsUrl?: string;
};

export const POPULAR_CATALOG: CatalogEntry[] = [
  {
    id: "github",
    slug: "github",
    title: "GitHub",
    summary: "Repos, issues, and pull requests. Sign in with GitHub on this Mac.",
    transport: "http",
    authMode: "github",
    url: "https://api.githubcopilot.com/mcp/",
    sseFallback: true,
    oauthBearerRef: "GITHUB_OAUTH_TOKEN",
    secrets: [
      {
        ref: "GITHUB_OAUTH_TOKEN",
        label: "GitHub access token",
        help: "Only needed if you prefer not to use GitHub’s command-line sign-in.",
        header: "Authorization",
        valuePrefix: "Bearer ",
      },
    ],
    docsUrl: "https://github.com/github/github-mcp-server",
  },
  {
    id: "notion",
    slug: "notion",
    title: "Notion",
    summary: "Search and update pages in your Notion workspace. Sign in with Notion in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.notion.com/mcp",
    sseFallback: true,
    oauthBearerRef: "NOTION_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://developers.notion.com/docs/mcp",
  },
  {
    id: "linear",
    slug: "linear",
    title: "Linear",
    summary: "Issues and projects in Linear. Sign in with Linear in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.linear.app/mcp",
    sseFallback: true,
    oauthBearerRef: "LINEAR_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://linear.app/docs/mcp",
  },
  {
    id: "gitlab",
    slug: "gitlab",
    title: "GitLab",
    summary: "Projects, issues, and merge requests on GitLab.com. Sign in with GitLab in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://gitlab.com/api/v4/mcp",
    sseFallback: true,
    oauthBearerRef: "GITLAB_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://docs.gitlab.com/user/model_context_protocol/mcp_server/",
  },
  {
    id: "jira",
    slug: "jira",
    title: "Jira",
    summary: "Jira issues, Confluence pages, and Bitbucket. Sign in with Atlassian in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.atlassian.com/v2/mcp",
    sseFallback: true,
    oauthBearerRef: "JIRA_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  },
  {
    id: "sentry",
    slug: "sentry",
    title: "Sentry",
    summary: "Errors, traces, and issue triage. Sign in with Sentry in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.sentry.dev/mcp",
    sseFallback: true,
    oauthBearerRef: "SENTRY_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "vercel",
    slug: "vercel",
    title: "Vercel",
    summary: "Projects, deployments, and logs. Sign in with Vercel in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.vercel.com",
    sseFallback: true,
    oauthBearerRef: "VERCEL_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://vercel.com/docs/mcp",
  },
  {
    id: "supabase",
    slug: "supabase",
    title: "Supabase",
    summary: "Projects, SQL, and Supabase features. Sign in with Supabase in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.supabase.com/mcp",
    sseFallback: true,
    oauthBearerRef: "SUPABASE_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "stripe",
    slug: "stripe",
    title: "Stripe",
    summary: "Payments, customers, and Stripe docs. Sign in with Stripe in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.stripe.com",
    sseFallback: true,
    oauthBearerRef: "STRIPE_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://docs.stripe.com/mcp",
  },
  {
    id: "posthog",
    slug: "posthog",
    title: "PostHog",
    summary: "Analytics, feature flags, and errors. Sign in with PostHog in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.posthog.com/mcp?mode=cli",
    sseFallback: true,
    oauthBearerRef: "POSTHOG_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://posthog.com/docs/model-context-protocol",
  },
  {
    id: "cloudflare",
    slug: "cloudflare",
    title: "Cloudflare",
    summary: "Workers, storage, DNS, and the rest of the Cloudflare API. Sign in with Cloudflare in the browser.",
    transport: "http",
    authMode: "oauth",
    url: "https://mcp.cloudflare.com/mcp",
    sseFallback: true,
    oauthBearerRef: "CLOUDFLARE_OAUTH_TOKEN",
    secrets: [],
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
  },
  {
    id: "filesystem",
    slug: "filesystem",
    title: "Filesystem",
    summary: "Read and write files inside one folder you choose.",
    transport: "stdio",
    authMode: "none",
    argv: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "{{path}}"],
    secrets: [],
    needsPath: true,
    pathLabel: "Allowed directory",
    pathPlaceholder: "/Users/you/Documents/projects",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "fetch",
    slug: "fetch",
    title: "Fetch",
    summary: "Fetch web pages so your coding app can read them. No sign-in needed.",
    transport: "stdio",
    authMode: "none",
    argv: ["npx", "-y", "@modelcontextprotocol/server-fetch"],
    secrets: [],
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "playwright",
    slug: "playwright",
    title: "Playwright",
    summary: "Open pages in a browser and check them. No sign-in needed.",
    transport: "stdio",
    authMode: "none",
    argv: ["npx", "-y", "@playwright/mcp@latest"],
    secrets: [],
    docsUrl: "https://playwright.dev/docs/getting-started-mcp",
  },
];

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return POPULAR_CATALOG.find((e) => e.id === id);
}
