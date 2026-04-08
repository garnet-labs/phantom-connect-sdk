module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/_release/"],
  moduleNameMapper: {
    "^@phantom/mcp-server$": "<rootDir>/../mcp-server/src/tools/index.ts",
    "^@phantom/constants$": "<rootDir>/../constants/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
