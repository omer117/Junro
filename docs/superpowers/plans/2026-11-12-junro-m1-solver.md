# M1 — Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `packages/solver` returns the fastest feasible visiting order for a day (exact), flags stages that cannot fit, supports cheapest insertion, and solves 12 stages in under 1 second.

**Architecture:** Pure TypeScript. One function `evaluateOrder` turns an order into times + violations (single source of truth for timing). `solve` runs Held-Karp over subsets, keeping for each state (visited set, last stage) the non-dominated labels `(lateness, departureTime)`; the winning order is rebuilt and re-evaluated with `evaluateOrder`. `insertStage` / `removeStage` reuse `evaluateOrder`.

**Tech Stack:** TypeScript strict, Vitest. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-junro-design.md` (Algorithm section); roadmap M1 table.

## Global Constraints

- The solver is pure: no network, no database, no Google, no `Date.now()`, no `Date`. Time is a plain `number` of **minutes since midnight** of the trip day.
- Travel time is injected as `TravelTimeFn(from, to, departureTime)`. Beta implementations ignore `departureTime`, but the solver always passes the real departure time of the leg.
- Opening hours are respected. A stage that cannot fit is returned with a `Violation`, never dropped.
- Waiting for a stage to open is allowed.
- Exact algorithm (Held-Karp), not a heuristic.
- Two edit modes stay distinct: `solve` (full recalculation) and `insertStage`/`removeStage` (minimal change, order kept).
- Test first: failing test, see it fail, implement, see it pass, then commit. `npm run lint` and `npm test` pass before every commit.
- Conventional Commits, English, with the Co-Authored-By line.

## Review Focus

Spec is silent on these; each gets a test in the task that owns it.

1. `TravelTimeFn` returns `Infinity` or `NaN` (Google could not route) → no crash, no silent wrong answer: treated as an unreachable leg; if every order needs one, `solve` throws `UnreachableError` naming the two stages. (Task 6)
2. More than 15 stages → `RangeError` with a clear message instead of freezing the browser/server on 2^n memory. (Task 6)
3. Duplicate stage ids, negative/NaN stay, window with `close <= open` → `InvalidInputError`. (Task 6)
4. Start time later than every window / day already over → all those stages come back as violations, order still returned. (Task 4)
5. Start and end at the same place with identical stage locations (zero travel) → deterministic order (ties broken by input order), not random. (Task 6)

## File structure (`packages/solver/src/`)

| File               | Responsibility                                                           |
| ------------------ | ------------------------------------------------------------------------ |
| `types.ts`         | All public types                                                         |
| `evaluate.ts`      | `evaluateOrder`: order → visits, end arrival, violations                 |
| `solve.ts`         | Held-Karp DP with labels, order reconstruction                           |
| `insert.ts`        | `insertStage`, `removeStage` (minimal change)                            |
| `validate.ts`      | Input validation, `InvalidInputError`, `UnreachableError`, `MAX_STAGES`  |
| `index.ts`         | Public exports only                                                      |
| `test-utils.ts`    | `lineTravel`, `stageAt` helpers (tests only)                             |

Test helpers: stages live on a line, `loc(x) = {lat: 0, lng: x}`; `lineTravel = (a, b) => Math.abs(a.lng - b.lng)` (1 unit = 1 minute). This makes every expected value hand-computable.

---

### Task 1: Types — `feat/m1-types`

**Files:** Create `types.ts`, `test-utils.ts`, `types.test.ts`; modify `index.ts`.

**Produces (exact shapes):**

```ts
type Minutes = number; // minutes since midnight
interface LatLng { lat: number; lng: number }
interface TimeWindow { open: Minutes; close: Minutes }
interface Stage { id: string; location: LatLng; stayMinutes: number; window?: TimeWindow }
type TravelTimeFn = (from: LatLng, to: LatLng, departureTime: Minutes) => number;
interface SolveInput {
  start: LatLng; end: LatLng; startTime: Minutes;
  stages: Stage[]; travelTime: TravelTimeFn;
}
interface Visit { stageId: string; arrival: Minutes; serviceStart: Minutes; departure: Minutes; waited: number }
type Violation =
  | { stageId: string; kind: 'closed'; minutesLate: number }      // service would end after close
  | { stageId: string; kind: 'window_too_short' };                  // stay longer than the window itself
interface SolveResult {
  order: string[]; visits: Visit[]; endArrival: Minutes;
  violations: Violation[]; totalLateness: number;
}
```

- [ ] **Step 1: Write the failing test** `types.test.ts`: builds a `SolveInput` with two stages using `stageAt`, asserts `lineTravel(loc(0), loc(5), 0) === 5`, and that `index.ts` exports the type names (a `satisfies` compile check run through `tsc`).
- [ ] **Step 2:** `npm test -w @junro/solver` → FAIL (`types`/`test-utils` missing).
- [ ] **Step 3:** Implement `types.ts` as above and `test-utils.ts` (`loc`, `lineTravel`, `stageAt(id, x, stay, window?)`); export types from `index.ts`.
- [ ] **Step 4:** test passes; `npx tsc -p packages/solver` exits 0.
- [ ] **Step 5:** Commit `feat(solver): add solver types`.

**Passes when:** the test passes and tsc is clean.

### Task 2: Held-Karp, no windows — `feat/m1-held-karp`

**Files:** Create `evaluate.ts`, `solve.ts`, `evaluate.test.ts`, `solve.test.ts`.

**Produces:** `evaluateOrder(input: SolveInput, order: string[]): SolveResult` and `solve(input: SolveInput): SolveResult`.

`evaluateOrder` semantics (used by everything): leave start at `startTime`; for each stage `arrival = depPrev + travelTime(prev, stage, depPrev)`; `serviceStart = max(arrival, window.open)`; `departure = serviceStart + stayMinutes`; `endArrival = lastDeparture + travelTime(last, end, lastDeparture)`.

- [ ] **Step 1: Write failing tests.**
  - `evaluate.test.ts`: start 0, end 0, startTime 540; stages A(x=10, stay 30), B(x=20, stay 15). `evaluateOrder(['A','B'])` → A arrival 550, departure 580; B arrival 590, departure 605; endArrival 625. Assert exactly these.
  - `solve.test.ts`: (a) three stages on a line at 30, 10, 20 (start 0, end 0, equal stays) → order `['10','20','30']` ids by position, `endArrival` equals the hand-computed value; (b) end ≠ start: start 0, end 100, stages at 90, 10, 50 → order 10, 50, 90 (monotone toward the end); (c) brute force cross-check: for 6 random-but-seeded stages (own tiny seeded PRNG in test-utils, no `Math.random`) compare `solve(...).endArrival` with the minimum over all 720 permutations via `evaluateOrder`.
- [ ] **Step 2:** run → FAIL (functions missing).
- [ ] **Step 3: Implement.** `evaluateOrder` as specified. `solve`: `dp[mask][last]` = earliest **departure time** from `last` having visited `mask` (Float64Array of size `2^n * n`, `Infinity` initial), `parent[mask][last]`. Init `dp[1<<j][j]` from start. Transition `dp[mask|1<<k][k] = min(dp[mask][j] + travel(j,k,dp[mask][j]) + stay_k)` (windows added in Task 3). Final: minimise `dp[full][j] + travel(j,end,dp[full][j])`. Rebuild order via `parent`, then return `evaluateOrder(input, order)`. Ties: lowest index wins (determinism). **Explain to Omer in Hebrew:** why "earliest departure" is the right state (arriving earlier is never worse when waiting is allowed) and why this is exact; complexity O(2^n · n²).
- [ ] **Step 4:** tests pass (including the 720-permutation check).
- [ ] **Step 5:** Commit `feat(solver): add Held-Karp solver`.

**Passes when:** the brute-force cross-check agrees on 5 different seeds.

### Task 3: Opening hours — `feat/m1-time-windows`

**Files:** Modify `solve.ts`, `evaluate.ts`; Test: `solve.windows.test.ts`.

Rule: a transition into stage `k` is feasible only if `serviceStart + stay <= window.close`; arrival before `open` waits until `open`.

- [ ] **Step 1: Failing tests.** (a) Two stages on a line, A at 10 with window `{open: 0, close: 600}`, B at 20 with `{open: 100, close: 600}`; stays 30; start 0, end 0, startTime 0. A then B: A dep 40, B arrival 50, waits to 100, dep 130, end 150. B then A: B arrival 20, waits to 100, dep 130, A arrival 140, dep 170, end 190. Assert order `['A','B']`, `visits[1].waited === 50`, `endArrival === 150`. (b) A window closes at 35 (stay 30, arrival 10 → ends 40 > 35) so A is infeasible as first leg but feasible if… use a case where only one order is feasible and assert that order is chosen even though it is longer. (c) Brute-force cross-check over feasible permutations with windows, seeded.
- [ ] **Step 2:** run → FAIL (windows ignored).
- [ ] **Step 3:** Implement: add the open-wait and close-prune to the DP transition and to `evaluateOrder`; infeasible transitions are skipped. If no complete feasible order exists, `solve` still returns something in Task 4 — for this task, tests only cover feasible inputs.
- [ ] **Step 4:** passes. Step 5: Commit `feat(solver): respect opening hours`.

**Passes when:** waiting is shown (`waited === 50`) and infeasible orders are never chosen when a feasible one exists.

### Task 4: Violations when nothing fits — `feat/m1-violations`

**Files:** Modify `solve.ts`, `evaluate.ts`; Test: `solve.violations.test.ts`.

Design: the DP keeps, per state, a small list of labels `(lateness, departure)`, dropping any label dominated by another (≤ in both). Transition always allowed; `lateness += max(0, serviceStart + stay - close)`. Final answer = minimal `(totalLateness, endArrival)` lexicographic. This is exact (a plain lexicographic single value is not, because a later-but-less-late state can win). If every stage fits, there is one label per state and it reduces to Task 3. **Explain to Omer in Hebrew** why Pareto labels are needed.

`evaluateOrder` produces `violations`: `closed` with `minutesLate = serviceStart + stay - close`; `window_too_short` when `stay > close - open` (always listed, even if otherwise reachable).

- [ ] **Step 1: Failing tests.** (a) Two stages both closing at 50 with stay 30, travel 10 each → impossible to serve both; result order keeps both stages, exactly one violation, `totalLateness` equal to the hand-computed minimum, and the late stage is the one with the least lateness (assert id). (b) Nothing dropped: `result.order.length === input.stages.length` always. (c) `startTime` after every window (Review Focus 4): all stages listed as violations, order still returned. (d) `window_too_short`: stay 90 in window of 60 → that violation kind. (e) Feasible input → `violations` is `[]` and result equals Task 3's.
- [ ] **Step 2:** FAIL. Step 3: implement labels. Step 4: all solver tests (Tasks 2–4) pass.
- [ ] **Step 5:** Commit `feat(solver): report violations instead of dropping stages`.

**Passes when:** no stage is ever missing from `order`, and a feasible input still gives zero violations.

### Task 5: Minimal change (cheapest insertion) — `feat/m1-cheapest-insertion`

**Files:** Create `insert.ts`, `insert.test.ts`; modify `index.ts`.

**Produces:**
```ts
insertStage(input: SolveInput, currentOrder: string[], newStage: Stage): SolveResult
removeStage(input: SolveInput, currentOrder: string[], stageId: string): SolveResult
```
`input.stages` holds the stages already in the day; `insertStage` tries every position `0..currentOrder.length`, scores each with `evaluateOrder`, picks lowest `(totalLateness, endArrival)`, ties → earliest position. The relative order of existing stages never changes. `removeStage` removes the id and re-evaluates (everything shifts earlier; nothing is re-sorted).

- [ ] **Step 1: Failing tests.** (a) Order `[10, 30]` on a line, insert stage at 20 → `[10, 20, 30]`, `endArrival` increases by the stay only (no detour). (b) Insert stage at 5 → goes first. (c) Existing order is kept even when a full `solve` would reorder it (construct a deliberately bad order `[30, 10]`, insert 20, assert existing relative order `30, 10` preserved). (d) `removeStage` shortens the order by one and `endArrival` does not increase. (e) Insert into an empty order. (f) Unknown id in `removeStage` → `InvalidInputError` (class from Task 6; add the class stub here if Task 6 is not yet done, it is moved in Task 6).
- [ ] **Step 2:** FAIL. Step 3: implement. Step 4: pass. Step 5: Commit `feat(solver): add cheapest insertion and removal`.

**Passes when:** (c) proves the two edit modes behave differently.

### Task 6: Validation and edge cases — `test/m1-edge-cases`

**Files:** Create `validate.ts`, `edge-cases.test.ts`; modify `solve.ts`, `insert.ts` to call `validateInput`.

**Produces:** `MAX_STAGES = 15`; `class InvalidInputError extends Error`; `class UnreachableError extends Error` (has `from: string`, `to: string`); `validateInput(input: SolveInput): void`.

- [ ] **Step 1: Failing tests.** 0 stages → `order: []`, `endArrival = startTime + travel(start,end)`; 1 stage; start = end; all stages at one location (travel 0) → order equals input order (determinism); stage longer than its window (already in Task 4, assert again with end-to-end `solve`); 16 stages → `RangeError` mentioning 15; duplicate ids, `stayMinutes: -1`, `stayMinutes: NaN`, window `{open: 600, close: 600}` → `InvalidInputError` each; `travelTime` returning `Infinity` for the only possible leg → `UnreachableError`; `Infinity` on one leg but another order avoids it → that order is chosen.
- [ ] **Step 2:** FAIL. Step 3: implement validation; in the DP treat non-finite leg as infeasible and throw `UnreachableError` if no complete order exists. Step 4: all tests pass. Step 5: Commit `test(solver): cover edge cases and validate input`.

**Passes when:** every Review Focus line 1–3 and 5 has a passing test.

### Task 7: Performance — `test/m1-performance`

**Files:** Create `performance.test.ts`.

- [ ] **Step 1:** Test: 12 stages from the seeded PRNG, with windows that are mostly feasible and a few tight; `const t0 = performance.now()` (test file only, the solver itself never reads time); assert `solve(...)` returns in `< 1000` ms and `order.length === 12`. Also assert a 15-stage run completes (no time assertion, to avoid a flaky CI; just prints the duration).
- [ ] **Step 2:** If it fails the budget: profile before changing anything. Likely fixes, in order: flat `Float64Array` labels instead of objects, iterate masks by popcount.
- [ ] **Step 3:** Pass locally and in CI. Step 4: Commit `test(solver): add 12-stage performance test`.

**Passes when:** 12 stages solve in under 1 s on the CI runner (Linux) and locally.

---

## Self-review

- Spec coverage: exact DP ✔ (T2), waiting + pruning ✔ (T3), lateness fallback + violations ✔ (T4), cheapest insertion / removal = skip ✔ (T5), edge cases ✔ (T6), 12 stages < 1 s ✔ (T7), `departureTime` always passed ✔ (T2 evaluate + DP; a test with a time-dependent `travelTime` is part of T2: travel that is +10 after 600 changes the answer).
- Mid-day recalculation (M5) and the stay-duration resolution (server side, M2) are not solver work; the solver receives `stayMinutes` already resolved.
- Names consistent across tasks: `evaluateOrder`, `solve`, `insertStage`, `removeStage`, `SolveInput`, `SolveResult`, `Violation`.
- Known limitation, documented in the code and README later: one opening window per stage per day (no lunch breaks); `travelTime` must be FIFO (leaving later never arrives earlier), true for walking/driving and for transit.

## Open points for Omer

1. **PR split.** CLAUDE.md says one PR per task; you asked for fewer approvals. Proposal: two PRs of per-task commits — `feat/m1-solver-core` (Tasks 1–4) and `feat/m1-insertion-and-hardening` (Tasks 5–7). OK?
2. **One window per stage per day.** Enough for beta (a place closed for a lunch break is rare)? Supporting a list of windows later is an additive change.
3. **Limit of 15 stages.** The 12-stage target is in the roadmap; 15 is a safety cap (2^15 · 15 states still fits in memory).
4. **Housekeeping:** `CLAUDE.md` ended up on `main` anyway (the PR #1 merge included the first commit, before my removal commit). Remove it in this PR, or keep it?
