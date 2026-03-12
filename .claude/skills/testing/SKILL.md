# Skill: testing

Run the full quality pipeline from the repo root to verify the codebase is in a healthy state.

**Arguments:** `[package-name]` — optional. If provided, scope lint, type-check, and tests to that package only. If omitted, run everything across the full monorepo.

---

## Pipeline steps

Run each step sequentially from the **repo root**. Stop and report on first failure — do not continue past a broken step.

### Step 1 — Format (Prettier)

```bash
yarn prettier
```

Prettier rewrites files in place. After it runs, check `git diff --stat` to see which files were modified. If any files changed, report them — it means they were not formatted before. The step itself is not a failure (Prettier auto-fixes), but unformatted files should be flagged as a finding.

### Step 2 — Build

```bash
# Full monorepo
yarn build

# Scoped to one package
yarn workspace @phantom/{package-name} build
```

A build failure means the output that consumers receive would be broken. Treat this as a blocker.

### Step 3 — Type check

```bash
# Full monorepo
yarn check-types

# Scoped to one package
yarn workspace @phantom/{package-name} check-types
```

Type errors that slip past the build (e.g. when `skipLibCheck` is on) are caught here. Treat any error as a blocker.

### Step 4 — Lint

```bash
# Full monorepo
yarn lint

# Scoped to one package
yarn workspace @phantom/{package-name} lint
```

Lint errors are blockers. Lint warnings should be reported but are not blockers.

### Step 5 — Tests

```bash
# Full monorepo
yarn test

# Scoped to one package
yarn workspace @phantom/{package-name} test
```

Any failing test is a blocker. Report the test name, file, and failure message.

---

## Output

After all steps complete, print a summary table:

| Step       | Status                     | Notes                                      |
| ---------- | -------------------------- | ------------------------------------------ |
| Prettier   | ✓ / files changed / failed | List of reformatted files if any           |
| Build      | ✓ / failed                 | Error summary if failed                    |
| Type check | ✓ / failed                 | Error count and first few errors if failed |
| Lint       | ✓ / warnings / failed      | Warning count; errors if failed            |
| Tests      | ✓ / failed                 | Failing test names and messages if failed  |

**Overall result:** PASS (all steps green) or FAIL (list blocking steps).

If the overall result is FAIL, suggest the most likely fix for each blocking step based on the error output — but do not automatically edit any files unless the user asks.

**Hard rules:**

- Always run from the repo root using yarn
- Never skip a step unless the user explicitly asks
- Never use `--force`, `--no-verify`, or any flag that bypasses checks
- If a scoped workspace name differs from the directory name, read `packages/{package-name}/package.json` to get the correct `"name"` field
