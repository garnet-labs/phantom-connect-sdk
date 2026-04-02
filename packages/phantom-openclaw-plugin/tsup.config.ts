import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  noExternal: ["@phantom/mcp-server", "@phantom/phantom-api-client"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
});
