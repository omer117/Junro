import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { HttpError } from '../errors.js';
import { GoogleNotConfiguredError } from '../google/errors.js';
import type { MapsClient } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';
import { departureInstant } from '../travel/departure.js';
import { loadDayProblem, remainingOf } from '../travel/day-problem.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay } from './ownership.js';

const query = z.object({
  /** When the leg starts, in minutes since midnight of the day. */
  at: z.coerce.number().int().min(0).max(2880),
});

export interface LegsRouterDeps {
  db: Db;
  /** Already wrapped by the usage guard. Undefined when no API key is configured. */
  maps: MapsClient | undefined;
  limiter: RateLimiter;
}

/**
 * GET /days/:id/legs/:index/alternatives?at=MINUTES
 * The ways to make one leg of a public transport day, quickest first. Leg 0 goes from the start
 * to the first stop, the last leg from the last stop to the end. It is one Google call, asked
 * only when the person opens "Other ways" for that leg.
 */
export function legsRouter({ db, maps, limiter }: LegsRouterDeps): Router {
  const router = Router();
  router.use('/days/:dayId/legs', requireAuth);

  router.get('/days/:dayId/legs/:index/alternatives', async (req, res) => {
    const userId = req.user!.id;
    const day = await requireOwnedDay(db, userId, uuidParam(req.params.dayId));

    const parsed = query.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Say when the leg starts (at, in minutes).');
    }
    const index = Number(req.params.index);

    if (day.travelMode !== 'transit') {
      throw new HttpError(409, 'not_transit', 'Other ways are for public transport days.');
    }
    const problem = await loadDayProblem(db, userId, day);
    const remaining = remainingOf(problem, day, day.liveFrom);
    if (
      remaining.solverStages.length === 0
        ? problem.rows.length === 0
        : remaining.savedIds.length !== remaining.solverStages.length
    ) {
      throw new HttpError(409, 'no_route', 'This day has no route yet.');
    }

    const byId = new Map(remaining.solverStages.map((s) => [s.id, s.location]));
    const route = [
      remaining.start,
      ...remaining.savedIds.map((id) => byId.get(id)!),
      remaining.end,
    ];
    if (!Number.isInteger(index) || index < 0 || index >= route.length - 1) {
      throw new HttpError(404, 'not_found', 'Not found');
    }

    if (!maps) throw new GoogleNotConfiguredError();
    if (!limiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many requests. Wait a moment.');
    }

    const from = route[index]!;
    const options = await maps.transitAlternatives({
      origin: from,
      destination: route[index + 1]!,
      departureTime: departureInstant({
        date: day.date,
        minutes: parsed.data.at,
        at: from,
        now: new Date(),
      }),
    });

    res.json({ options: [...options].sort((a, b) => a.minutes - b.minutes) });
  });

  return router;
}
