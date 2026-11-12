# Junro 順路

Junro is a trip planner. You lay out a trip day by day, drop places onto each day, and Junro
finds the fastest order to visit them — respecting how long you like to stay and when each place
is open.

## The name

順路 (_junro_) means "the route to follow". It is the arrow sign you see in Japanese museums that
tells you which way to walk next.

## Status

Beta in progress. The repository setup (M0) is done; the solver comes next.

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

## License

No license. The code is public to read; all rights reserved.
