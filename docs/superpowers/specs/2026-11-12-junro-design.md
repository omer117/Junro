# Junro — design

Date: 2026-11-12
Status: draft, waiting for Omer's approval

## Intent

Junro (順路, "the route to follow" — the arrow sign in Japanese museums) is a trip planner.
A user builds a trip day by day, drops places onto each day, and Junro finds the fastest
order to visit them, respecting how long they like to stay and when places are open.

Why it exists:
- **Portfolio project** for student developer roles. Team leads should see real engineering:
  a clean client/server split, a self-written optimization algorithm with tests, caching,
  quota handling, and a live demo.
- **Personal use** on real trips (first target: Japan).

## Goals (beta)

- Accounts, with trips saved per user.
- Trip → days → each day has a start point, an end point and a start time.
- Add stages (places) to a day by searching Google Places; each stage has a category from a
  fixed list.
- "Find my route" computes the fastest order from start to end and shows it on the map with an
  animation.
- Opening hours are respected; stages that cannot fit are flagged, not dropped.
- Editing a day that already has a route offers two modes: **minimal change** or **full
  recalculation**.
- Mid-day recalculation from the user's current location, ignoring completed stages.
- Walking and driving.
- Mobile-first, map-centred UI; desktop layout too.

## Non-goals (beta)

- Public transit (planned as the first feature after beta — see Later).
- Automatically dropping stages when a day is over-full (planned — see Later).
- Per-country colour palettes.
- Social features, sharing trips with other users.
- Native mobile apps.

## Anti-goals

- **Data overload.** Junro must not feel like Wanderlog: no walls of tables, ratings,
  ads or lists the user did not ask for. Each screen shows what the user needs now.
- **Generic look.** No default template aesthetics.
- **Surprise bills.** The Google APIs must never cost money; hard quotas, not hope.
- **"Just calls Google."** The ordering algorithm is Junro's own. Google's Route Optimization
  API is deliberately not used.

## Approaches considered

| | Stack | Trade-off |
|---|---|---|
| **A (chosen)** | React + TypeScript client, Node + Express + TypeScript server, PostgreSQL | One language end to end, matches what Omer already uses (React/TS in a course project). Full server is visible engineering. More server work (auth, persistence). |
| B | React client, Python + FastAPI server | Pleasant for algorithm code, shows breadth. Two toolchains, time spent switching languages. |
| C | Next.js + Supabase | Fastest to a working product. Most of the backend is "bought", so less to show. |

Chosen: **A**, because it uses what Omer already knows and keeps all the engineering visible.

## Decisions made with Omer

### Product
- Each place in a day is a **stage**.
- Categories are a hardcoded list (restaurant, bar, temple, museum, market, park, …).
- **Stay duration** per stage resolves in three levels:
  1. system minimum per category,
  2. the user's own default per category (stored in their profile, ≥ the minimum),
  3. a manual override on a single stage.
- **When no order fits all stages in time** (opening hours / end of day): return the best order
  and flag each violating stage in the UI with a warning colour, an icon and a sentence
  (e.g. "Opens at 17:00 — you would arrive early"). The user decides what to cut.
- **Editing a day with a route:** user chooses
  - *minimal change* — keep the current order, insert a new stage at the position that adds
    the least time (cheapest insertion); removing a stage just skips it;
  - *full recalculation* — run the full algorithm again.
- **Mid-day recalculation:** completed stages are excluded; the device's current geolocation
  becomes the new start; the end point is unchanged. A stage is marked done by a manual tap
  (auto-detection by location may come later).
- Travel mode is chosen per day (walking / driving in beta).

### Algorithm
- Problem: path-TSP with fixed start and end, node weights (stay duration) and edge weights
  (travel time), plus time windows (opening hours).
- Exact solution with **Held-Karp style DP over subsets**: state = (set of visited stages,
  last stage), value = **earliest possible arrival time** at that state. Transitions that
  arrive after a stage closes are infeasible. Waiting for a stage to open is allowed.
  Typical day ≤ ~12 stages, so exact DP is fast.
- If no feasible full order exists, fall back to the order that minimises total lateness and
  report the violating stages (for the UI flag).
- Travel time is an interface `travelTime(from, to, departureTime)`. In beta the departure
  time is ignored. Public transit later plugs in a time-dependent implementation without
  changing the solver (the earliest-arrival state already supports it).
- The solver is a pure module (no I/O) with its own unit tests.

### Data sources (Google Maps Platform)
- **Maps JavaScript API** — the interactive map, route drawing, animation.
- **Places API (New)** — Autocomplete for search; Place Details for location, category hints
  and opening hours. Place details are stored in the database, not re-requested on every
  route calculation (within what Google's terms allow).
- **Routes API** — Compute Route Matrix for pairwise travel times (solver input);
  Compute Routes for the final polyline.
- **Browser Geolocation API** — current location for mid-day recalculation.
- Hard per-API quotas set in Google Cloud so usage stays inside the free monthly caps.
- Possible later swap: self-hosted OSRM on the server for the travel-time matrix, to save
  matrix quota. (Google Places data must stay on a Google map, so map + places remain Google.)
- The Google API key lives only on the server; the client calls Junro's server.

### Auth
- OAuth via a multi-provider library (e.g. Passport.js). Beta: Google sign-in. Facebook and
  others added later without restructuring.

### Hosting
- Client: Vercel, responsive (phone first).
- Server: Oracle Cloud free tier.

### Design
- Direction "Golden hour": twilight indigo ink (#1E1B3A), pale-sky ground (#EEF1F6),
  apricot accent (#F59A4A); warning #C2410C / #B23A0A with icon + text, never colour alone.
- Type: Bricolage Grotesque (headings), Figtree (body), Noto Sans JP for 順路.
- The map fills the screen; everything else floats over it (bottom sheet on phone, side panel
  on desktop).
- The trip header is a **boarding pass** (route codes, departure, countdown stub).
- Results are phrased for humans ("Back at the hotel by 19:40"), not tables.
- Mockups: Claude design canvas — trips home, day map, route found, desktop planner,
  "Night line" live-day alternative, landing page (desktop + phone).
- The map itself gets a custom style to match the palette.

## Left to the builder (Claude's calls, open to correction)

- Monorepo layout: `client/`, `server/`, `packages/solver/` (shared, pure TS), one root
  `.gitignore` (Node template).
- ORM / query layer for PostgreSQL (e.g. Prisma or Drizzle).
- Map animation: a visual effect (candidate routes flashing, then the final route), not a
  literal replay of the DP.
- Test runner (e.g. Vitest) and CI on GitHub Actions running solver tests.
- How long route matrices are cached per day and when they are invalidated.

## Later (after beta)

1. Public transit (time-dependent travel times; most important for Japan).
2. Automatic stage dropping by user priority ("must" / "if there is time") — an orienteering
   variant on top of the current solver.
3. More sign-in providers.
4. Auto-detect arrival at a stage by location.
5. Per-country palettes.
