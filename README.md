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

## License

No license. The code is public to read; all rights reserved.
