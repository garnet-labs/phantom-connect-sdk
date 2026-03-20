/**
 * Lightweight jwt-decode mock: decodes the payload without signature verification.
 * Used in tests where the real jwt-decode package is unavailable in this workspace.
 */
function jwtDecode(token) {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) throw new Error("Invalid JWT token");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

module.exports = { jwtDecode };
