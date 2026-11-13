import { evaluateOrder, type SolveInput } from '@junro/solver';
import { Router } from 'express';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { loadDayProblem } from '../travel/day-problem.js';
import { readCachedTravelTimes } from '../travel/matrix.js';
import { readRouteLine } from '../travel/route-line.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay } from './ownership.js';

/**
 * GET /days/:id/route
 * The route the day has now, so the screen can show it again when it is opened. It is worked
 * out from what is saved (the order, the stays, the opening hours) and from the cached travel
 * times, so it follows edits such as a longer stay, and it NEVER calls Google or costs quota.
 * When it cannot be worked out from the cache (a new stop, a new travel mode, no solve yet),
 * the answer is 204 (no content) and the person presses "Find my route".
 */
export function routeRouter(db: Db): Router {
  const router = Router();
  router.use('/days/:dayId/route', requireAuth);

  router.get('/days/:dayId/route', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.dayId));
    const { start, end, solverStages, rows, savedIds } = await loadDayProblem(
      db,
      req.user!.id,
      day,
    );
    // "No route yet" is a normal answer, so it is 204 (No Content), not an error: browsers show a
    // 404 as a red error in the console every time the day screen asks.
    const noRoute = () => res.status(204).end();

    // A route exists only when every stop has its place in it.
    if (solverStages.length === 0 || savedIds.length !== rows.length) return noRoute();

    const travelTime = await readCachedTravelTimes({
      db,
      dayId: day.id,
      mode: day.travelMode,
      points: [start, end, ...solverStages.map((s) => s.location)],
    });
    if (!travelTime) return noRoute();

    const input: SolveInput = {
      start,
      end,
      startTime: day.startTime,
      stages: solverStages,
      travelTime,
    };
    const result = evaluateOrder(input, savedIds);

    const byId = new Map(solverStages.map((s) => [s.id, s]));
    const routeLine = await readRouteLine({
      db,
      dayId: day.id,
      mode: day.travelMode,
      route: [start, ...result.order.map((id) => byId.get(id)!.location), end],
    });

    res.json({
      mode: 'saved',
      order: result.order,
      visits: result.visits,
      endArrival: result.endArrival,
      violations: result.violations,
      totalLateness: result.totalLateness,
      routeLine,
    });
  });

  return router;
}
