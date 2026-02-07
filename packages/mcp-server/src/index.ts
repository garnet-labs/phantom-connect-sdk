#!/usr/bin/env node

import { PhantomMCPServer } from "./server.js";

// Export SessionManager for testing
export { SessionManager } from "./session/manager.js";

async function main() {
  const server = new PhantomMCPServer();
  await server.start();
}

// Only run the server if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
