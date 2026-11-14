import {
  InvalidInputError,
  UnreachableError,
  evaluateOrder,
  insertStage,
  solve,
  type SolveInput,
  type SolveResult,
} from '@junro/solver';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { stages } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { GoogleNotConfiguredError } from '../google/errors.js';
import type { MapsClient } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';
import { loadDayProblem } from '../travel/day-problem.js';
import { loadTravelTimes } from '../travel/matrix.js';
import { loadRouteLine } from '../travel/route-line.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay } from './ownership.js';

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const solveBody = z
  .object({
    mode: z.enum(['full', 'minimal']),
    /** Where the user is now, and the time (minutes since midnight). Both or neither. */
    from: latLng.optional(),
    now: z.number().int().min(0).max(2880).optional(),
  })
  .refine((body) => (body.from === undefined) === (body.now === undefined), {
    message: 'Send both from and now, or neither',
  });

export interface SolveRouterDeps {
  db: Db;
  /** Already wrapped by the usage guard. Undefined when no API key is configured. */
  maps: MapsClient | undefined;
  limiter: RateLimiter;
}

/**
 * POST /days/:id/solve
 *   full     recalculate the best order from scratch.
 *   minimal  keep the order the user has; new stages go where they add the least time and
 *            removed stages are skipped. Without a saved order it falls back to full.
 */
export function solveRouter({ db, maps, limiter }: SolveRouterDeps): Router {
  const router = Router();
  router.use('/days/:dayId/solve', requireAuth);

  router.post('/days/:dayId/solve', validateBody(solveBody), async (req, res) => {
    const userId = req.user!.id;
    const day = await requireOwnedDay(db, userId, uuidParam(req.params.dayId));
    const { mode: requested, from, now } = req.body as z.infer<typeof solveBody>;

    if (!maps) throw new GoogleNotConfiguredError();
    if (!limiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many route calculations. Wait a moment.');
    }

    const problem = await loadDayProblem(db, userId, day);

    // Mid-day: stages that are done are not planned again. If the user says where they are and
    // what time it is, the route starts there and then; the end point stays the day's end point.
    const doneIds = new Set(problem.rows.filter((r) => r.stage.done).map((r) => r.stage.id));
    const solverStages = problem.solverStages.filter((s) => !doneIds.has(s.id));
    const savedIds = problem.savedIds.filter((id) => !doneIds.has(id));
    const { end } = problem;
    const start = from ?? problem.start;
    const startTime = now ?? day.startTime;

    // All travel times for the day, fetched (or read from the cache) before solving.
    const travelTime = await loadTravelTimes({
      db,
      maps,
      dayId: day.id,
      mode: day.travelMode,
      points: [start, end, ...solverStages.map((s) => s.location)],
    });
    const input: SolveInput = {
      start,
      end,
      startTime,
      stages: solverStages,
      travelTime,
    };

    const mode = requested === 'minimal' && savedIds.length > 0 ? 'minimal' : 'full';

    let result: SolveResult;
    try {
      result = mode === 'full' ? solve(input) : minimalChange(input, savedIds);
    } catch (error) {
      if (error instanceof UnreachableError) {
        throw new HttpError(422, 'unreachable', 'Some stages cannot be reached from each other.');
      }
      if (error instanceof InvalidInputError || error instanceof RangeError) {
        throw new HttpError(409, 'cannot_solve', error.message);
      }
      throw error;
    }

    // Save the order, then draw the line. A failing line must not throw the order away.
    // Done stages keep the front of the order, in the order they had; the new order follows.
    const doneInOrder = problem.rows
      .filter((r) => doneIds.has(r.stage.id))
      .sort((a, b) => (a.stage.position ?? Infinity) - (b.stage.position ?? Infinity))
      .map((r) => r.stage.id);
    const toSave = [...doneInOrder, ...result.order];
    await db.transaction(async (tx) => {
      for (const [position, stageId] of toSave.entries()) {
        await tx.update(stages).set({ position }).where(eq(stages.id, stageId));
      }
    });

    const byId = new Map(solverStages.map((s) => [s.id, s]));
    let routeLine: string | null = null;
    let routeLineError: string | undefined;
    try {
      routeLine = await loadRouteLine({
        db,
        maps,
        dayId: day.id,
        mode: day.travelMode,
        route: [start, ...result.order.map((id) => byId.get(id)!.location), end],
      });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      routeLineError = error.code;
    }

    res.json({
      mode,
      order: result.order,
      visits: result.visits,
      endArrival: result.endArrival,
      violations: result.violations,
      totalLateness: result.totalLateness,
      routeLine,
      ...(routeLineError ? { routeLineError } : {}),
    });
  });

  return router;
}

/**
 * Keeps the saved order (`savedIds`). Stages that are not in it yet are new: each one goes
 * where it adds the least time. Stages that were removed are simply not there any more.
 */
function minimalChange(input: SolveInput, savedIds: string[]): SolveResult {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const placed = savedIds.map((id) => byId.get(id)!);
  const added = input.stages.filter((s) => !savedIds.includes(s.id));

  let order = [...savedIds];
  for (const stage of added) {
    order = insertStage({ ...input, stages: [...placed] }, order, stage).order;
    placed.push(stage);
  }
  return evaluateOrder({ ...input, stages: placed }, order);
}
