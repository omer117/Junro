# M0 — Repository Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `npm test` and `npm run lint` pass locally and in CI on an empty workspace.

**Architecture:** npm workspaces monorepo (`client/`, `server/`, `packages/solver/`) with one shared strict `tsconfig.base.json`, one root ESLint + Prettier config, and Vitest in every workspace. CI runs install, lint, test on every PR.

**Tech Stack:** Node 22 LTS, npm workspaces, TypeScript (strict), ESLint 9 flat config + typescript-eslint, Prettier, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-12-junro-design.md`; roadmap `docs/superpowers/plans/2026-11-12-junro-beta-roadmap.md` (M0 table).

## Global Constraints

- Never commit to `main`; one branch per task from an up-to-date `main`; branch names exactly as in the roadmap table.
- Conventional Commits; commit/PR text in English; commits end with the Co-Authored-By line.
- Before every commit: `npm run lint` and `npm test` pass (from the task that creates them onward).
- `.env*` never committed, except `.env.example`.
- No license file (decided).
- Every new dependency is justified in the PR description.
- After each PR: stop, explain to Omer in Hebrew, wait for merge.

## Review Focus

- `vitest` exits 1 when no test files exist → each workspace gets a smoke test (not `--passWithNoTests`), so an accidentally empty workspace is noticed.
- Windows (CRLF) vs CI Linux (LF): Prettier `endOfLine: "lf"` + `.gitattributes` `* text=auto eol=lf`, so lint does not differ between machines.
- `npm ci` in CI requires a committed `package-lock.json`.
- `.gitignore` must ignore `.env`, `.env.local`, `.env.*` but keep `.env.example` (verified with `git check-ignore`).
- Lint must not scan `dist/`, `node_modules/`, `coverage/`.

---

### Task 0: This plan — branch `docs/m0-plan`

**Files:** Create `docs/superpowers/plans/2026-11-12-junro-m0-repo-setup.md` (this document).

- [ ] Branch from `main`, add this file, commit `docs(m0): add M0 repo setup plan`, push, open PR. Merge after Omer's approval.

### Task 1: Root `.gitignore` — branch `chore/m0-gitignore`

**Files:** Create `.gitignore`.

- [ ] **Step 1 (check fails first):** `git check-ignore -v node_modules/x .env .env.local .env.production` → no output (nothing ignored yet).
- [ ] **Step 2:** Write `.gitignore`: GitHub Node template, plus `.env` / `.env.*` / `!.env.example`, `dist/`, `coverage/`, `.vscode/*` kept minimal, OS files (`.DS_Store`, `Thumbs.db`).
- [ ] **Step 3 (pass):** same `check-ignore` command lists all four paths; `git check-ignore .env.example` prints nothing (not ignored); `git status` shows only `.gitignore`.
- [ ] **Step 4:** Commit `chore: add root .gitignore`, push, PR.

**Passes when:** the commands above behave as stated.

### Task 2: npm workspaces — branch `chore/m0-workspaces`

**Files:**
- Create: `package.json` (private, `"workspaces": ["client","server","packages/*"]`, `engines.node >=22`), `tsconfig.base.json` (`strict: true`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `noUncheckedIndexedAccess`, `skipLibCheck`, `isolatedModules`), `.nvmrc` (`22`), `.gitattributes` (`* text=auto eol=lf`)
- Create per workspace (`client`, `server`, `packages/solver`): `package.json` (names `@junro/client`, `@junro/server`, `@junro/solver`; private; `"type": "module"`), `tsconfig.json` (extends `../tsconfig.base.json` / `../../tsconfig.base.json`), `src/index.ts` (empty export `export {};`)
- Generated and committed: `package-lock.json`

- [ ] **Step 1 (fail):** `npm ls --workspaces` → error / no workspaces.
- [ ] **Step 2:** Create the files above. TypeScript installed once at root as a devDependency.
- [ ] **Step 3 (pass):** `npm install` succeeds; `npm ls --workspaces` lists the three packages; `npx tsc --noEmit -p <each workspace>` exits 0; adding `const x: number = "a"` temporarily in one workspace makes tsc fail (proves strict is inherited) — revert it.
- [ ] **Step 4:** Commit `chore: set up npm workspaces and strict tsconfig`, push, PR.

**Passes when:** all three workspaces are listed and typecheck, and a type error is caught.

### Task 3: ESLint + Prettier — branch `chore/m0-lint`

**Files:** Create `eslint.config.js` (flat config: `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-config-prettier` last; ignores `**/dist`, `**/coverage`, `**/node_modules`), `.prettierrc.json` (`semi`, `singleQuote`, `printWidth 100`, `endOfLine: "lf"`), `.prettierignore`. Modify root `package.json`: scripts `lint` (`eslint . && prettier --check .`), `format` (`prettier --write .`).
Dependencies (why): `eslint`, `@eslint/js`, `typescript-eslint` (standard TS linting), `prettier`, `eslint-config-prettier` (avoids rule conflicts).

- [ ] **Step 1 (fail):** write a deliberately bad file `packages/solver/src/bad.ts` (`var a = 1` unformatted, unused variable); `npm run lint` → fails (script missing at first → then once configured, flags the file).
- [ ] **Step 2:** Add configs and scripts.
- [ ] **Step 3:** `npm run lint` fails on `bad.ts` with specific rule errors; delete `bad.ts`; `npm run lint` exits 0 on the clean workspace.
- [ ] **Step 4:** Commit `chore: add ESLint and Prettier`, push, PR. (`bad.ts` is not committed.)

**Passes when:** lint fails on bad code and passes on the clean repo.

### Task 4: Vitest in every workspace — branch `chore/m0-test-runner`

**Files:**
- Create: `vitest.workspace.ts` (root, lists the three workspaces), `vitest.config.ts` in each workspace (`client` uses `environment: "jsdom"` later — for M0 use `node`; switch in M4), `src/smoke.test.ts` in each workspace
- Modify: root `package.json` script `test` → `vitest run`; each workspace `package.json` script `test` → `vitest run`
- Dependency (why): `vitest` (fast, native TS/ESM, same config family as Vite used by the client).

- [ ] **Step 1 (fail):** write `smoke.test.ts` in `packages/solver` first: `it("runs", () => expect(1 + 1).toBe(2))`; `npm test` fails because no runner is installed.
- [ ] **Step 2:** Install vitest, add configs, copy a smoke test into `client` and `server`.
- [ ] **Step 3 (pass):** `npm test` runs 3 test files, all pass, exit 0. `npm test -w @junro/solver` runs only solver. Temporarily change an assertion to `toBe(3)` → exit 1; revert.
- [ ] **Step 4:** `npm run lint` and `npm test` both pass; commit `chore: add Vitest to every workspace`, push, PR.

**Passes when:** `npm test` reports 3 passing files from 3 workspaces, and a broken assertion fails it.

### Task 5: GitHub Actions CI — branch `chore/m0-ci`

**Files:** Create `.github/workflows/ci.yml`: trigger `pull_request` and `push` to `main`; job on `ubuntu-latest`; steps `actions/checkout`, `actions/setup-node` (node from `.nvmrc`, `cache: npm`), `npm ci`, `npm run lint`, `npm test`.

- [ ] **Step 1:** Add workflow; validate locally that `npm ci && npm run lint && npm test` works on a clean clone state (delete `node_modules`, run).
- [ ] **Step 2 (pass):** open PR; the "CI" check turns green on GitHub (`gh pr checks`).
- [ ] **Step 3 (fail proves CI works):** push a throwaway commit with a failing assertion to the PR branch → check turns red; then revert it (force-free: add a revert commit).
- [ ] **Step 4:** Commit `chore: add GitHub Actions CI`, PR.
- [ ] **Follow-up (manual, Omer):** in GitHub settings, require the CI check before merge on `main` (outside the repo; I will say so, not do it).

**Passes when:** CI is green on the PR and was seen red on a broken commit.

### Task 6: README skeleton — branch `docs/m0-readme`

**Files:** Create `README.md`: what Junro is, the name story (順路, "the route to follow", the arrow sign in Japanese museums), tech stack, repo layout, how to run (`nvm use`, `npm install`, `npm run lint`, `npm test`), status line ("M0 done, beta in progress"), "All rights reserved" note (no license). Sections for later milestones are not stubbed with invented content.

- [ ] **Step 1:** Write README, English, from spec facts only.
- [ ] **Step 2 (pass):** follow the README commands on a clean clone — they work as written; `npm run lint` passes (Prettier checks the markdown).
- [ ] **Step 3:** Commit `docs: add README skeleton`, PR.

**Passes when:** the "how to run" commands work verbatim.

### Last item in the table: "No license file" — no task, no file. Verified by `ls LICENSE*` returning nothing at the end of M0.

## Self-review

- Every table row maps to a task (license row = non-task). Done-when criterion is covered by Tasks 3–5.
- Names consistent: `@junro/client|server|solver`, scripts `lint` / `test` / `format`.
- Milestone close-out (after Task 6): a short "M0 done" note in the roadmap file, as its own tiny `docs/m0-done` PR — only if Omer agrees.

## Open points for Omer

1. `CLAUDE.md` is currently untracked on `main`. Proposal: commit it in the `docs/m0-plan` PR, since it can't go straight to `main`.
2. Node 22 LTS as the baseline (CI + `.nvmrc`) — OK?
3. Prettier style: single quotes, semicolons, width 100 — OK?
