import { accessSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageDir = resolve(__dirname, "..");
const tarballPath = join(packageDir, "package.tgz");

const run = (command, args, cwd) => {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertLocalUrl = (value, envName) => {
  const parsed = new URL(value);
  const isLocalHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  assert(isLocalHost, `${envName} must use localhost/127.0.0.1 for pack tests, got: ${value}`);
};

let tempInstallDir = "";

try {
  // Build npm tarball exactly as release packaging does.
  run("yarn", ["pack"], packageDir);
  assert(existsSync(tarballPath), "Expected package.tgz to be created by yarn pack");

  // Install the tarball into a clean temporary project.
  tempInstallDir = mkdtempSync(join(tmpdir(), "phantom-mcp-pack-test-"));
  writeFileSync(
    join(tempInstallDir, "package.json"),
    JSON.stringify({ name: "pack-test", private: true, version: "1.0.0" }, null, 2),
  );

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], tempInstallDir);

  const installedPackageDir = join(tempInstallDir, "node_modules", "@phantom", "mcp-server");
  assert(existsSync(installedPackageDir), "Installed package directory not found");

  // Verify the library entrypoint loads without side effects.
  const requireFromTempProject = createRequire(join(tempInstallDir, "index.js"));
  const loaded = requireFromTempProject("@phantom/mcp-server");
  assert(loaded && typeof loaded === "object", "Package did not export an object");
  const exportKeys = Object.keys(loaded).sort();
  assert(exportKeys.includes("SessionManager"), "Expected SessionManager export");
  assert(exportKeys.includes("tools"), "Expected tools export");
  assert(!exportKeys.includes("PhantomMCPServer"), "Internal server class should not be publicly exported");
  assert(typeof loaded.SessionManager === "function", "SessionManager export must be a function");
  assert(Array.isArray(loaded.tools), "tools export must be an array");

  // Verify CLI binary exists and is executable.
  const cliBinPath = join(tempInstallDir, "node_modules", ".bin", "phantom-mcp");
  assert(existsSync(cliBinPath), "phantom-mcp binary not found in installed package");
  accessSync(cliBinPath, constants.X_OK);

  // Verify publish footprint excludes source and test files.
  assert(!existsSync(join(installedPackageDir, "src")), "Published package should not include src/");
  assert(!existsSync(join(installedPackageDir, "scripts")), "Published package should not include scripts/");
  assert(existsSync(join(installedPackageDir, "dist", "index.js")), "Published package missing dist/index.js");
  assert(existsSync(join(installedPackageDir, "dist", "cli.js")), "Published package missing dist/cli.js");

  // Verify CLI can start from installed package under no-network guardrails.
  const authBaseUrl = process.env.PHANTOM_AUTH_BASE_URL ?? "http://127.0.0.1:1";
  const apiBaseUrl = process.env.PHANTOM_API_BASE_URL ?? "http://127.0.0.1:1";
  assertLocalUrl(authBaseUrl, "PHANTOM_AUTH_BASE_URL");
  assertLocalUrl(apiBaseUrl, "PHANTOM_API_BASE_URL");

  const cliRun = spawnSync("node", [join(installedPackageDir, "dist", "cli.js")], {
    cwd: tempInstallDir,
    timeout: 1500,
    env: {
      ...process.env,
      PHANTOM_AUTH_BASE_URL: authBaseUrl,
      PHANTOM_API_BASE_URL: apiBaseUrl,
      HOME: tempInstallDir,
    },
    stdio: "ignore",
  });
  assert(
    cliRun.signal === "SIGTERM" || cliRun.status === 0,
    `Installed CLI did not start as expected (status=${cliRun.status}, signal=${cliRun.signal})`,
  );

  const installedPackageJson = JSON.parse(readFileSync(join(installedPackageDir, "package.json"), "utf8"));
  assert(installedPackageJson.name === "@phantom/mcp-server", "Installed package name mismatch");

  process.stdout.write(`test:pack succeeded (exports: ${exportKeys.join(", ")})\n`);
} finally {
  if (existsSync(tarballPath)) {
    rmSync(tarballPath, { force: true });
  }
  if (tempInstallDir && existsSync(tempInstallDir)) {
    rmSync(tempInstallDir, { recursive: true, force: true });
  }
}
