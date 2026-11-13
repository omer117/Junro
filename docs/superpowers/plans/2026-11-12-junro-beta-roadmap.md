# Junro beta — roadmap

Spec: `docs/superpowers/specs/2026-11-12-junro-design.md`
Rules for Claude Code: `CLAUDE.md`

The beta is built in 7 milestones (M0–M6). Each milestone ends with something that works and is
tested on its own. Before a milestone starts, it gets its own detailed plan in
`docs/superpowers/plans/` (test-first steps for every task).

## How we work

- `main` is always green and deployable. Nobody commits to `main` directly.
- **One branch per task**, created from an up-to-date `main`:
  `<type>/m<N>-<short-name>` — e.g. `feat/m1-held-karp`, `chore/m0-ci`, `fix/m3-matrix-cache`.
  Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.
- Commits follow Conventional Commits (`feat(solver): add earliest-arrival DP`).
- Every task: failing test → code → tests pass → commit → PR into `main`.
- A PR is merged (squash) only when CI is green and Omer has reviewed it.
- At the end of each milestone: a review of everything merged in it, then a short
  "milestone done" note in this file.

## M0 — Repository setup

Done when: `npm test` and `npm run lint` pass locally and in CI on an empty workspace.

| Task | Branch |
|---|---|
| Root `.gitignore` (Node template, plus `.env*` except `.env.example`) | `chore/m0-gitignore` |
| npm workspaces: `client/`, `server/`, `packages/solver/`; shared `tsconfig.base.json` (strict) | `chore/m0-workspaces` |
| ESLint + Prettier, shared config | `chore/m0-lint` |
| Vitest in every workspace | `chore/m0-test-runner` |
| GitHub Actions: install, lint, test on every PR | `chore/m0-ci` |
| README skeleton (what Junro is, the name story, how to run) | `docs/m0-readme` |
| No license file — decided: the code is public to read, all rights reserved | — |

## M1 — Solver (`packages/solver`)

Pure TypeScript, no I/O, no Google. Done when all solver tests pass and a 12-stage day solves
in under 1 second.

| Task | Branch |
|---|---|
| Types: `Stage`, `TimeWindow`, `TravelTimeFn(from, to, departureTime)`, `SolveInput`, `SolveResult`, `Violation` | `feat/m1-types` |
| Exact solver: Held-Karp DP over subsets, state = (visited set, last stage), value = earliest arrival; fixed start and end | `feat/m1-held-karp` |
| Opening hours: time windows, waiting allowed, infeasible transitions pruned | `feat/m1-time-windows` |
| No feasible order: return the order with least total lateness + list of violating stages | `feat/m1-violations` |
| Minimal change: cheapest insertion of a new stage into an existing order; removal = skip | `feat/m1-cheapest-insertion` |
| Edge cases: 0 stages, 1 stage, start = end, identical locations, stage longer than its window | `test/m1-edge-cases` |
| Performance test: 12 stages < 1 s | `test/m1-performance` |

## M2 — Server core (`server/`)

Done when a signed-in user can create a trip, days and stages through the API, with tests.

| Task | Branch |
|---|---|
| Express + TypeScript app, `/health`, error handler, request validation (zod) | `feat/m2-app-skeleton` |
| PostgreSQL in Docker Compose for local dev; ORM schema: `User`, `CategoryPreference`, `Trip`, `Day`, `Stage`, `Place`, `RouteMatrixCache` | `feat/m2-db-schema` |
| Auth: Passport with Google OAuth (structure ready for more providers), sessions | `feat/m2-auth-google` |
| API: trips CRUD | `feat/m2-trips-api` |
| API: days CRUD (start point, end point, start time, travel mode) | `feat/m2-days-api` |
| API: stages CRUD (category, stay override, done flag) | `feat/m2-stages-api` |
| API: per-user stay duration per category (never below the system minimum) | `feat/m2-category-prefs` |
| Authorization: users only ever see and change their own data | `feat/m2-ownership` |

## M3 — Google integration (`server/`)

Done when `POST /days/:id/solve` returns an ordered route with times and violations, using
cached Google data, and the API key never leaves the server.

| Task | Branch |
|---|---|
| Places Autocomplete proxy endpoint | `feat/m3-places-search` |
| Place Details: fetch once, store in `Place`, parse opening hours into time windows for a date | `feat/m3-place-details` |
| Route Matrix service implementing `TravelTimeFn` (walking / driving), cached per day | `feat/m3-route-matrix` |
| Compute Routes: polyline for the chosen order | `feat/m3-route-polyline` |
| Solve endpoint: full recalculation and minimal-change modes | `feat/m3-solve-endpoint` |
| Usage guard: count calls per API, refuse before the free cap; clear errors when Google fails | `feat/m3-quota-guard` |
| Google Cloud: hard quotas configured (manual, documented in README) | `docs/m3-quotas` |

## M4 — Client (`client/`)

Done when the full planning flow works on a phone and on desktop against the local server.

| Task | Branch |
|---|---|
| Vite + React + TypeScript app, routing, API client | `feat/m4-app-skeleton` |
| Design tokens (colours, type, spacing) from the design canvas; fonts | `feat/m4-design-tokens` |
| Map component: Maps JavaScript API with the custom map style | `feat/m4-map` |
| Sign-in flow (Google) | `feat/m4-sign-in` |
| Trips home with the boarding-pass header and day stubs | `feat/m4-trips-home` |
| Day screen: full-screen map, bottom sheet, place search, stages with category icons, travel mode | `feat/m4-day-screen` |
| Find my route: call solve, animation, route line, human summary, timeline, violation warnings | `feat/m4-find-route` |
| Edit a day that has a route: choose minimal change or recalculate | `feat/m4-edit-modes` |
| Settings: stay duration per category | `feat/m4-category-settings` |
| Desktop layout: side panel + map | `feat/m4-desktop-layout` |

## M5 — Live day

Done when, during a day, the user can mark stages done and recalculate from where they stand.

| Task | Branch |
|---|---|
| Geolocation permission and current position (with a clear message when denied) | `feat/m5-geolocation` |
| Mark a stage done | `feat/m5-mark-done` |
| Recalculate from current location: done stages excluded, end point kept | `feat/m5-recalc-from-here` |

## M6 — Launch

Done when Junro is live on its own address and the README lets a team lead understand it in
two minutes.

| Task | Branch |
|---|---|
| Server on Oracle Cloud free tier: build, process manager, HTTPS, PostgreSQL, secrets in env | `chore/m6-deploy-server` |
| Client on Vercel, environment variables, production API URL | `chore/m6-deploy-client` |
| Landing page (desktop + phone) from the design canvas | `feat/m6-landing` |
| README: demo GIF, architecture diagram, solver explanation (Held-Karp, complexity, time windows) | `docs/m6-readme` |

## After beta (not now)

Public transit, automatic stage dropping by priority, more sign-in providers, arrival
auto-detection, per-country palettes, several opening windows per stage per day (places
that close for a lunch break; beta uses one window, earliest opening to latest closing),
modern map markers and cloud-based map styling with a Map ID (beta uses a JSON style and SVG
markers).
