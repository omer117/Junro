# Junro 順路

Junro is a trip planner. You lay out a trip day by day, drop places onto each day, and Junro
finds the fastest order to visit them — respecting how long you like to stay and when each place
is open.

## The name

順路 (_junro_) means "the route to follow". It is the arrow sign you see in Japanese museums that
tells you which way to walk next.

## Status

Beta in progress. The repository setup (M0), the solver (M1) and the server core (M2) are done.

## Tech stack

- **Client:** React + TypeScript + Vite (hosted on Vercel)
- **Server:** Node + Express + TypeScript, PostgreSQL (hosted on Oracle Cloud free tier)
- **Solver:** a pure TypeScript package — exact Held-Karp DP with time windows, no I/O
- **Maps and places:** Google Maps Platform

## Repository layout

| Path               | What it is                                     |
| ------------------ | ---------------------------------------------- |
| `client/`          | The web app                                    |
| `server/`          | The API server                                 |
| `packages/solver/` | The route-ordering algorithm (pure TypeScript) |
| `docs/`            | Design spec and milestone plans                |

## Running it

You need Node 22 (see `.nvmrc`).

```bash
npm install
npm run lint
npm test
```

## Running the server locally

You need Node 22 and Docker.

```bash
cp .env.example .env              # then edit SESSION_SECRET
docker compose up -d --wait       # PostgreSQL on port 5434 (databases: junro and junro_test)
npm run db:migrate -w @junro/server
npm run dev -w @junro/server      # http://localhost:3000/health
```

`npm test` also needs the database from `docker compose`.

### Google sign-in (optional locally)

1. In Google Cloud Console create an OAuth client ID of type "Web application".
2. Add `http://localhost:3000/auth/google/callback` as an authorised redirect URI.
3. Put the client ID and secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_CALLBACK_URL`). Without them the server runs, and `/auth/google` answers 503.

## Google Maps Platform (places and routes)

The server uses the Places API (New) for search and place details, and the Routes API for
travel times and the route line. The API key lives only on the server (`GOOGLE_API_KEY`).

**Protecting the free tier.** Google gives a free monthly allowance per product (check the
current numbers on the
[pricing list](https://developers.google.com/maps/billing-and-pricing/pricing): at the time of
writing 10,000 / 5,000 / 1,000 calls for Essentials / Pro / Enterprise products). Place Details
with opening hours is an Enterprise product, so only 1,000 per month are free. Junro protects
itself in layers:

1. Every Google call goes through a usage guard that counts per API and per month (Pacific
   time, like Google's billing) and refuses before the cap. Defaults sit well below the free
   tiers; change them with `GOOGLE_CAP_AUTOCOMPLETE`, `GOOGLE_CAP_PLACE_DETAILS`,
   `GOOGLE_CAP_ROUTE_MATRIX` (counted in matrix elements) and `GOOGLE_CAP_COMPUTE_ROUTES`.
   A cap of `0` switches that API off.
2. A place is fetched from Google once and stored; search results are cached for 10 minutes;
   travel times are cached per day and only new points are requested; an unchanged route
   line is never requested again; every call asks only for the fields it needs.
3. Per-user rate limits on search, new places and solving.
4. Hard quotas in Google Cloud (below), as the last line of defence if the code has a bug.

### One-time setup in Google Cloud (manual)

Use the same project as the sign-in. Menu names change from time to time.

1. **Enable the APIs:** APIs & Services, Library. Enable **Places API (New)** and
   **Routes API**.
2. **Billing:** Google requires a billing account for Maps Platform even for the free tier.
   Billing, Budgets & alerts, create a budget of a few dollars with alerts at 50%, 90% and
   100%. A budget only warns; it does not stop spending. The quotas in step 4 do.
3. **API key:** APIs & Services, Credentials, Create credentials, API key. Under "API
   restrictions" choose "Restrict key" and select only Places API (New) and Routes API. Put
   the key in `.env` as `GOOGLE_API_KEY`. Never commit it, never send it to the browser.
4. **Hard quotas:** APIs & Services, open each API, Quotas & System Limits. Lower the daily
   limit of every request type to roughly the monthly cap divided by 30, so a bug cannot burn
   the whole month in a day. Keep them below the free allowance.
5. Check the usage page of each API a few days after you start using Junro.

## License

No license. The code is public to read; all rights reserved.
