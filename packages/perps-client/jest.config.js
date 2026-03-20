module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Allow Jest to transform @msgpack/msgpack (ESM package)
  transformIgnorePatterns: ["node_modules/(?!(@msgpack)/)"],
};
