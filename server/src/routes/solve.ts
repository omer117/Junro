import {
  InvalidInputError,
  UnreachableError,
  evaluateOrder,
  insertStage,
  solve,
  type SolveInput,
  type SolveResult,
  type Stage,
} from '@junro/solver';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { categoryPreferences, places, stages } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { GoogleNotConfiguredError } from '../google/errors.js';
import { windowForDate } from '../google/opening-hours.js';
import type { MapsClient, OpeningHours } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';
import { resolveStayMinutes } from '../stay.js';
import { loadTravelTimes } from '../travel/matrix.js';
import { loadRouteLine } from '../travel/route-line.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay } from './ownership.js';

const solveBody = z.object({ mode: z.enum(['full', 'minimal']) });

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
    const { mode: requested } = req.body as z.infer<typeof solveBody>;

    if (!maps) throw new GoogleNotConfiguredError();
    if (!limiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many route calculations. Wait a moment.');
    }

    // The day's stages with their places, in the order they were added. A full solve always
    // starts from this order, so the same stages give the same answer every time (stages that
    // tie, for example two at the same distance, never swap places between runs).
    const rows = await db
      .select({ stage: stages, place: places })
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.dayId, day.id))
      .orderBy(asc(stages.createdAt), asc(stages.id));

    const preferences = await db
      .select()
      .from(categoryPreferences)
      .where(eq(categoryPreferences.userId, userId));
    const preferred = new Map(preferences.map((p) => [p.category, p.stayMinutes]));

    // Stay: stage override, then the user's preference, then the system minimum.
    // Opening hours: that weekday's window, or "closed all day".
    const solverStages: Stage[] = rows.map(({ stage, place }) => ({
      id: stage.id,
      location: { lat: place.lat, lng: place.lng },
      stayMinutes: resolveStayMinutes({
        category: stage.category,
        preference: preferred.get(stage.category),
        override: stage.stayOverrideMinutes,
      }),
      ...windowForDate(place.openingHours as OpeningHours | null, day.date),
    }));

    const start = { lat: day.startLat, lng: day.startLng };
    const end = { lat: day.endLat, lng: day.endLng };

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
      startTime: day.startTime,
      stages: solverStages,
      travelTime,
    };

    const savedIds = rows
      .filter((r) => r.stage.position !== null)
      .sort((a, b) => a.stage.position! - b.stage.position!)
      .map((r) => r.stage.id);
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
    await db.transaction(async (tx) => {
      for (const [position, stageId] of result.order.entries()) {
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
