# Junro — instructions for Claude Code

Junro (順路) is a trip planner: users lay out trip days, add places, and Junro finds the fastest
order to visit them, respecting stay durations and opening hours. It is Omer's portfolio project
and a tool he will use on real trips.

Read before any work:
- Spec: `docs/superpowers/specs/2026-11-12-junro-design.md`
- Roadmap: `docs/superpowers/plans/2026-11-12-junro-beta-roadmap.md`
- The plan for the current milestone in `docs/superpowers/plans/`

## Working with Omer

- Talk to Omer in **Hebrew**, short and step by step. Code, comments, commit messages, PRs and
  docs in the repo are in **English**.
- Omer must be able to explain every part of this code in a job interview. When you write
  something non-obvious (especially in the solver), explain it to him in a few sentences.
- Do not start work outside the current task. If something else needs doing, say so and ask.
- Do not add features that are not in the spec. Ideas go in the "After beta" list, after asking.

## Git workflow

- Never commit to `main`. Never force-push `main`.
- One branch per task, from an up-to-date `main`: `<type>/m<N>-<short-name>`
  (`feat/m1-held-karp`, `chore/m0-ci`, `fix/m3-matrix-cache`).
- Conventional Commits: `feat(solver): …`, `fix(server): …`, `test(solver): …`.
- Test first: write the failing test, see it fail, implement, see it pass, then commit.
- Before every commit: `npm run lint` and `npm test` pass.
- Open a PR into `main` per task. Omer reviews and merges (squash).

## Architecture

- npm workspaces: `client/` (React + TypeScript + Vite), `server/` (Node + Express +
  TypeScript, PostgreSQL), `packages/solver/` (pure TypeScript).
- Client hosted on Vercel; server on Oracle Cloud free tier.

## Must

- **The solver is pure**: no network, no database, no Google, no `Date.now()`. It receives a
  `TravelTimeFn(from, to, departureTime)` and returns an order, times and violations.
- **Exact algorithm**: Held-Karp DP over subsets with earliest-arrival state. Keep the
  `departureTime` parameter even though beta ignores it — public transit depends on it.
- **Opening hours are respected.** Stages that cannot fit are returned with a violation, never
  silently dropped.
- **Stay duration** resolves: stage override → user's category preference → system minimum.
  A user preference can never go below the system minimum.
- **Two edit modes** stay distinct: minimal change (cheapest insertion, order kept) and full
  recalculation.
- **Mid-day recalculation** excludes done stages, starts from the current location, keeps the
  end point.
- **Secrets stay on the server.** The Google API key is read from env on the server only.
  `.env` files are never committed; keep `.env.example` up to date.
- **Protect the free tier**: Place Details are fetched once and stored; route matrices are
  cached per day; every Google call goes through the usage guard.
- **Users only access their own data** — check ownership on every route.
- **UI is mobile first and map centred**: the map fills the screen; everything else is a bottom
  sheet (phone) or side panel (desktop).
- **Design tokens from the design canvas** ("Golden hour"): ink `#1E1B3A`, ground `#EEF1F6`,
  accent `#F59A4A`, warning `#C2410C` / text `#B23A0A`. Fonts: Bricolage Grotesque (headings),
  Figtree (body), Noto Sans JP (順路).
- **Accessibility**: touch targets ≥ 44 px, text contrast ≥ 4.5:1, real `<button>` / `<a>` /
  `<label>`, warnings use an icon and text, never colour alone.
- **Human phrasing** in results ("Back at the hotel by 19:40"), not raw numbers.
- **UI copy in English.**

## Must not

- Do not use Google's Route Optimization API or any external solver for the ordering — the
  algorithm is Junro's own.
- Do not show Google Places data on a non-Google map.
- Do not call Google APIs from the client, except the Maps JavaScript API for displaying the
  map.
- Do not overload screens with data: no rating walls, review lists, ads, or tables the user did
  not ask for. Show what the user needs now.
- Do not use generic template looks: no default component-library theme, no purple gradients,
  no emoji as icons, no Inter as the main font.
- Do not invent data in the UI (fake reviews, user counts, stats).
- Do not build post-beta features (public transit, auto-dropping stages, extra sign-in
  providers) unless Omer asks.
- Do not commit secrets, `.env`, credentials, or large generated files.
- Do not add a dependency without saying why; prefer small, well-known packages.
