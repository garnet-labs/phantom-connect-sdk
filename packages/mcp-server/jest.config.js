module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: ["node_modules/(?!(open)/)"],
  coverageThreshold: {
    "./src/server.ts": {
      branches: 45,
      functions: 60,
      lines: 60,
      statements: 60,
    },
    "./src/tools/pay-api-access.ts": {
      branches: 85,
      functions: 100,
      lines: 100,
      statements: 95,
    },
    "./src/utils/network.ts": {
      branches: 90,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/utils/payment.ts": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/utils/amount.ts": {
      branches: 85,
      functions: 100,
      lines: 95,
      statements: 95,
    },
  },
};
