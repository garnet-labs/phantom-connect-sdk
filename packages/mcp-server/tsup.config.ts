import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["cjs"],
  dts: true,
  clean: true,
  platform: "node",
  target: "node18",
  noExternal: [/.*/],
});
