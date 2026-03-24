const sharedJestConfig = require("../../sharedJestConfig");

module.exports = {
  ...sharedJestConfig,
  testEnvironment: "node",
  displayName: "@phantom/phantom-api-client",
};
