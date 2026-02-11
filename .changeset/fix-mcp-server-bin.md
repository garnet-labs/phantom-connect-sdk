---
"@phantom/mcp-server": patch
---

Fix MCP server executable not running when installed via npm/npx. The bin wrapper script was preventing the main server code from executing due to a failed `require.main === module` check. Changed to point bin directly to the built dist/index.js file, following the standard pattern used by official MCP servers.
