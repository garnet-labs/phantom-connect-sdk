#!/usr/bin/env node

/**
 * CLI entry point for the Phantom MCP server.
 *
 * This file always starts the server when loaded — it has no `require.main`
 * guard because launchers like Claude Desktop's built-in Node.js runtime
 * `require()` the entry point rather than executing it directly, which
 * causes `require.main === module` to be false.
 *
 * Library consumers should import from the package root (index.ts) instead.
 */

import { PhantomMCPServer } from "./server.js";

const server = new PhantomMCPServer();
server.start().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
