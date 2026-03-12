# Skill: audit

Perform a structured code quality review of a single package in this monorepo.

**Arguments:** `<package-name>` — matches a directory under `packages/` (e.g. `react-sdk`, `browser-sdk`, `auth2`). If `all` or empty, do an architecture-level review instead.

---

## Phase 0 — Check previous audits

Glob `audit/*-{package-name}*.md`. If a recent audit exists, read it for prior findings, resolved items, and open issues. Treat it as a hypothesis, not ground truth — verify every claim against current code before repeating it.

---

## Phase 1 — Read and understand

Read every source file in `packages/{package-name}/src/`. Build a map of:

- What the package **exports** (check `packages/{package-name}/src/index.ts` and package.json `exports` field)
- What it **imports** from other workspace packages (`@phantom/*`)
- What external APIs, browser APIs, or runtime globals it talks to
- What events or callbacks it emits/subscribes to
- Any React context providers or hooks it exposes

**Environment branch scan:** Before moving on, grep the package for `process.env.NODE_ENV`, `import.meta.env`, `__TEST__`, or any test-environment guards in business logic. Any branch on `NODE_ENV === 'test'` inside non-test files is a red flag — it means tests run different code than production. Flag every hit with file and line number.

---

## Phase 2 — Read the tests

Read all test files (`*.test.ts`, `*.test.tsx`, `**/__tests__/**/*.ts`, `**/__tests__/**/*.tsx`) in the package. Assess:

- What is tested vs what is not
- Mock quality: are mocks accurate representations of real dependencies?
- Assertion specificity: do tests verify outcomes or just that functions were called?
- Whether tests exercise error paths, edge cases, and not just the happy path

---

## Phase 3 — Assess quality

Rate each dimension **Good / Fair / Poor** with one specific observation each:

| Dimension              | Rating | Specific observation |
| ---------------------- | ------ | -------------------- |
| Implementation quality |        |                      |
| Error handling         |        |                      |
| Type safety            |        |                      |
| Unit test coverage     |        |                      |
| Integration coverage   |        |                      |
| Architectural fit      |        |                      |
| Security               |        |                      |

Be honest — most packages are mixed. "Good overall" is not useful.

---

## Phase 4 — Gap analysis checkpoint

Before writing recommendations, explicitly answer:

1. What files in this package did I **not** read?
2. What cross-package interactions did I **not** trace?
3. What assumptions am I making about how callers use this package?
4. What would **break** this package — a network failure, a missing localStorage key, a concurrent call, an invalid input?
5. What trade-offs does the current code make that may be intentional?

---

## Phase 5 — Recommendations

Three tiers:

- **Critical** — bugs or security issues that exist now
- **Important** — prevents future problems, technical debt with real cost
- **Nice-to-have** — quality improvements, no urgency

For each item: **what** the issue is, **why** it matters (with specific `file:line`), the **trade-off** of fixing it, and a **priority** within the tier.

No phantom issues — only report what you can point to in code.

---

## Output

Write the report to `audit/YYYY-MM-DD-{package-name}.md` (use today's date). Print the full report in the conversation. If a file for the same package and date already exists, append `-2`.

**Hard rules:**

- Never recommend changes to code you haven't read
- Every finding must reference a specific `file:line`
- "Error handling could be better" is banned — say what the handler does wrong and what it should do instead
- Never edit source files — only write the audit doc
