const sharedJestConfig = require("../../sharedJestConfig");

module.exports = {
  ...sharedJestConfig,
  displayName: "@phantom/embedded-provider-core",
  setupFiles: ["<rootDir>/src/test/setup.ts"],
};
