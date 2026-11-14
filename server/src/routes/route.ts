import { evaluateOrder, type SolveInput } from '@junro/solver';
import { Router } from 'express';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { loadDayProblem, remainingOf } from '../travel/day-problem.js';
import { readCachedHybridTimes, legsOf, type HybridTimes } from '../travel/hybrid.js';
import { readCachedTravelTimes } from '../travel/matrix.js';
import { readRouteLine, readTransitRouteLine } from '../travel/route-line.js';
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
    const problem = await loadDayProblem(db, req.user!.id, day);
    const { start, end, startTime, solverStages, savedIds, live } = remainingOf(
      problem,
      day,
      day.liveFrom,
    );
    // "No route yet" is a normal answer, so it is 204 (No Content), not an error: browsers show a
    // 404 as a red error in the console every time the day screen asks.
    const noRoute = () => res.status(204).end();

    // A route exists only when every stop has its place in it.
    // (Stops that are done are not part of it.)
    if (problem.rows.length === 0 || savedIds.length !== solverStages.length) return noRoute();

    const points = [start, end, ...solverStages.map((s) => s.location)];
    // A public transport day was planned for one moment; it is saved, so reading it later (when
    // the clock has moved on) still finds the same times and lines.
    const departureTime = day.travelMode === 'transit' ? day.transitDeparture : null;
    let hybrid: HybridTimes | null = null;
    let travelTime: SolveInput['travelTime'] | null;
    if (day.travelMode === 'transit') {
      if (!departureTime) return noRoute();
      hybrid = await readCachedHybridTimes({ db, dayId: day.id, points, departureTime });
      travelTime = hybrid?.travelTime ?? null;
    } else {
      travelTime = await readCachedTravelTimes({
        db,
        dayId: day.id,
        mode: day.travelMode,
        points,
      });
    }
    if (!travelTime) return noRoute();

    const input: SolveInput = {
      start,
      end,
      startTime,
      stages: solverStages,
      travelTime,
    };
    const result = evaluateOrder(input, savedIds);

    const byId = new Map(solverStages.map((s) => [s.id, s]));
    const route = [start, ...result.order.map((id) => byId.get(id)!.location), end];
    const legs = hybrid ? legsOf(route, hybrid) : null;
    const routeLine =
      hybrid && departureTime
        ? await readTransitRouteLine({ db, dayId: day.id, route, departureTime })
        : await readRouteLine({ db, dayId: day.id, mode: day.travelMode, route });

    res.json({
      mode: 'saved',
      order: result.order,
      visits: result.visits,
      endArrival: result.endArrival,
      violations: result.violations,
      totalLateness: result.totalLateness,
      live,
      ...(legs ? { legs } : {}),
      ...(hybrid ? { transitAvailable: hybrid.transitAvailable } : {}),
      routeLine,
    });
  });

  return router;
}
