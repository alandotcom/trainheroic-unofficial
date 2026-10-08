/**
 * Addresses the website repeats across pages. The custom Astro pages import these directly, and
 * blume.config.ts exposes them to the MDX docs as Blume variables (`{{mcp-url}}` and so on), so
 * changing a value here updates every page on the next build.
 */

/** The hosted multi-tenant MCP server. `/coach` and `/athlete` narrow it to one role. */
export const MCP_URL = "https://mcp.trainheroic-unofficial.com/mcp";

/** The inbox for questions about the unofficial integration. */
export const SUPPORT_EMAIL = "support@trainheroic-unofficial.com";

/** The public source repository. Issues filed there are public too. */
export const REPO_URL = "https://github.com/alandotcom/trainheroic-unofficial";

/** The npm organization that publishes the CLI, SDK, and local MCP servers. */
export const NPM_ORG_URL = "https://www.npmjs.com/org/trainheroic-unofficial";
