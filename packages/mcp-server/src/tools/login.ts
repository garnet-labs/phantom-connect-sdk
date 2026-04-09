/**
 * phantom_login tool — triggers a fresh authentication flow
 *
 * Clears the current session and re-authenticates using the configured
 * auth flow (SSO browser redirect or RFC 8628 device code).
 *
 * This tool is handled specially in server.ts before the normal
 * client/session resolution so it works even when not yet authenticated.
 */

import type { ToolHandler } from "./types.js";

export const loginTool: ToolHandler = {
  name: "phantom_login",
  description:
    "Re-authenticate with Phantom. Use this to log in for the first time, switch accounts, or refresh an expired session. " +
    "Set displayMode to 'text' if you want the login prompt returned as text instead of trying to open a browser automatically.",
  inputSchema: {
    type: "object",
    properties: {
      displayMode: {
        type: "string",
        enum: ["browser", "text"],
        description:
          "'browser' (default) tries to open the browser automatically. 'text' returns the login prompt text instead.",
      },
    },
  },
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // Placeholder — actual execution is handled in server.ts before normal dispatch
  handler: () => {
    throw new Error("phantom_login must be handled by the server before normal tool dispatch.");
  },
};
