# Skill: fix-audit

Implement findings from the latest audit report for a package, one item at a time.

**Arguments:** `<package-name> [developer notes]` — package name plus optional free-text notes (e.g. `"only fix #1"`, `"skip #2, needs discussion"`, `"fix all but use X pattern for #1 instead"`).

---

## Phase 0 — Load

Find the most recent `audit/*-{package-name}*.md` (sort by filename date descending). Record this exact filename — it is the **audit file** for all later steps. Extract unresolved **Critical** items — an item is resolved if it contains `**Resolved` or has strikethrough text.

If no unresolved Criticals exist, check developer notes — if they say "important", work the **Important** tier instead.

Print the final work list before starting any changes.

---

## For each item (work sequentially — fully complete one before starting the next)

### Step 1 — Read before touching

Re-read the relevant source files in `packages/{package-name}/src/`. Verify the bug still exists at the exact file:line the audit references. Apply developer notes if they override the implementation approach.

### Step 2 — Implement

Minimal change that fixes exactly what the audit item describes. Rules:

- Never use TypeScript escape hatches (`as any`, `@ts-ignore`, `@ts-expect-error` without justification)
- Never add `eslint-disable` comments to hide a warning caused by the fix
- Never skip writing tests

### Step 3 — Self-review

Before running tests, ask:

- Does the fix make sense in the full application context?
- Are callers in other packages affected? Check usages with grep across `packages/` and `examples/`.
- Does it change a public contract — exported type, hook return shape, event payload?
- Is there anything the audit item missed that makes the fix incomplete?

### Step 3.5 — Write tests first

Write a test that **would have failed before the fix and passes now**. Assert the exact corrected behaviour. Place the test in the package's existing test file or create a new `*.test.ts` alongside the changed file.

This step is mandatory — do not skip it.

### Step 4 — Run the full test pipeline

Run each command from the **repo root** using yarn:

```bash
# Format check
yarn prettier --check .

# Type check
yarn check-types

# Lint
yarn lint

# Build (catches bundler and declaration errors)
yarn workspace @phantom/{package-name} build

# Unit tests scoped to the package
yarn workspace @phantom/{package-name} test

# Full test suite
yarn test
```

If the package name differs from the directory name, check `packages/{package-name}/package.json` for the `"name"` field to get the correct workspace name.

If any step fails after **3 fix attempts**, stop and report the failure — do not loop indefinitely.

### Step 5 — Mark resolved

Append to the audit item in the **audit file recorded in Phase 0**:

```md
**Resolved (YYYY-MM-DD):** [What changed, in which file:lines. Tests added: list test names.]
```

---

## Phase 2 — Docs

If the fix changed a public contract (exported type, hook API, event shape), update:

- The package's own `README.md` if it documents that API
- Any usage in `examples/react-sdk-demo-app/` if it depends on the changed package

---

## Phase 3 — Summary

Print:

- What was implemented and where
- What was skipped and why
- Test pipeline results (pass/fail per step)
- Any docs changed
- Follow-ups that still need attention

**Hard rules:**

- One item at a time
- Minimal scope — don't refactor surrounding code while fixing an item
- Tests must be green before marking resolved
- Never mark pre-existing test failures as caused by this change
- Respect developer notes — if they say skip something, skip it and say why in the summary
