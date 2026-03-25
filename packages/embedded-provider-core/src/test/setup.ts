// Setup TextEncoder/TextDecoder for jsdom test environment only
// Note: This is ONLY for testing - production code remains isomorphic
// and uses native TextEncoder/TextDecoder available in browsers and Node.js
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require("util");
  Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
    configurable: true,
  });
}
