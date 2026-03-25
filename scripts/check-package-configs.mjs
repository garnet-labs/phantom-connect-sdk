#!/usr/bin/env node
/**
 * Validates that every public package in packages/* has:
 *   1. repository.url === EXPECTED_REPO_URL
 *   2. pack-release script + publishConfig.directory (required when workspace: deps are present)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.resolve(__dirname, "../packages");
const EXPECTED_REPO_URL = "https://github.com/phantom/phantom-connect-sdk";

const errors = [];

const packageDirs = fs
  .readdirSync(PACKAGES_DIR)
  .filter(name => fs.statSync(path.join(PACKAGES_DIR, name)).isDirectory());

for (const dir of packageDirs) {
  const pkgPath = path.join(PACKAGES_DIR, dir, "package.json");
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.private) continue;

  const prefix = `[${pkg.name}]`;

  // 1. repository.url check
  if (pkg.repository?.url !== EXPECTED_REPO_URL) {
    errors.push(`${prefix} repository.url is "${pkg.repository?.url ?? ""}", expected "${EXPECTED_REPO_URL}"`);
  }

  // 2. pack-release + publishConfig required when workspace: deps are present
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
  const hasWorkspaceDeps = Object.values(allDeps).some(v => String(v).startsWith("workspace:"));

  if (hasWorkspaceDeps) {
    if (!pkg.scripts?.["pack-release"]) {
      errors.push(`${prefix} has workspace: deps but is missing the "pack-release" script`);
    }
    if (pkg.publishConfig?.directory !== "_release/package") {
      errors.push(`${prefix} has workspace: deps but publishConfig.directory is not "_release/package"`);
    }
  }
}

if (errors.length > 0) {
  console.error("Package config check failed:\n");
  errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
} else {
  console.log(`Package config check passed (${packageDirs.length} packages checked).`);
}
